import type { AgentApiResultImage } from './agentApi'
import type {
  AgentConversation,
  AgentMessage,
  AgentRound,
  AppSettings,
  ApiProfile,
  ResponsesOutputItem,
  TaskParams,
  TaskRecord,
} from '../types'
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS } from '../types'
import { collectAgentRoundOutputImageSlots, getAgentGeneratedImageReferenceId } from './agentImageReferences'
import { getAgentRoundPath } from './agentConversationGraph'
import { IMAGE_FETCH_CORS_HINT } from './imageApiShared'

export interface LegacyAgentExecutionState {
  tasks: TaskRecord[]
  agentConversations: AgentConversation[]
  setTasks: (tasks: TaskRecord[]) => void
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
}

export interface LegacyAgentExecutionDependencies {
  getState: () => LegacyAgentExecutionState
  loadAgentApi: () => Promise<typeof import('./agentApi')>
  ensureImageCached: (imageId: string) => Promise<string | null | undefined>
  buildApiInput: (conversation: AgentConversation, round: AgentRound, tasks: TaskRecord[]) => Promise<unknown[]>
  updateConversation: (conversationId: string, updater: (conversation: AgentConversation) => AgentConversation) => void
  createId: () => string
  putTask: (task: TaskRecord) => Promise<unknown>
  storeImage: (dataUrl: string, source: 'generated') => Promise<string>
  cacheImage: (imageId: string, dataUrl: string) => void
  updateTask: (taskId: string, patch: Partial<TaskRecord>) => void
  appendAssistantMessageContent: (conversationId: string, messageId: string, delta: string) => void
  mergeResponseOutputItems: (previous: ResponsesOutputItem[], next: ResponsesOutputItem[]) => ResponsesOutputItem[]
  countResponseToolCalls: (output: ResponsesOutputItem[]) => number
  buildContinuationInput: (
    baseInput: unknown[],
    round: AgentRound,
    tasks: TaskRecord[],
    currentRoundOutput: ResponsesOutputItem[],
    toolCallsUsed: number,
    maxToolCalls: number,
  ) => unknown[]
  markRoundStopped: (conversationId: string, roundId: string) => boolean
  getNetworkErrorHint: (
    error: unknown,
    startedAt: number,
    usesApiProxy: boolean,
    activeProfile: ApiProfile,
  ) => string | null
}

const legacyAgentRoundControllers = new Map<string, AbortController>()

function getLegacyAgentRoundControllerKey(conversationId: string, roundId: string) {
  return `${conversationId}:${roundId}`
}

export function getLegacyAgentRoundController(conversationId: string, roundId: string) {
  return legacyAgentRoundControllers.get(getLegacyAgentRoundControllerKey(conversationId, roundId))
}

function createAgentAbortError() {
  return new DOMException('Agent 请求已停止', 'AbortError')
}

export async function executeLegacyAgentRound(
  dependencies: LegacyAgentExecutionDependencies,

  conversationId: string,
  roundId: string,
  params: TaskParams,
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const controllerKey = getLegacyAgentRoundControllerKey(conversationId, roundId)
  legacyAgentRoundControllers.set(controllerKey, controller)
  try {
    const { callAgentResponsesApi, callBatchImageSingle, parseBatchImageCallArguments } =
      await dependencies.loadAgentApi()
    const latestState = dependencies.getState()
    const conversation = latestState.agentConversations.find((item) => item.id === conversationId)
    if (!conversation) return
    const round = conversation.rounds.find((item) => item.id === roundId)
    const userMessage = round ? conversation.messages.find((message) => message.id === round.userMessageId) : null
    if (!round || !userMessage) return
    const maskDataUrl = round.maskImageId
      ? ((await dependencies.ensureImageCached(round.maskImageId)) ?? undefined)
      : undefined
    if (round.maskImageId && !maskDataUrl) throw new Error('遮罩图片已不存在')

    const apiInput = await dependencies.buildApiInput(conversation, round, latestState.tasks)
    if (controller.signal.aborted) throw createAgentAbortError()
    const existingAssistantMessage = round.assistantMessageId
      ? (conversation.messages.find((message) => message.id === round.assistantMessageId) ?? null)
      : (conversation.messages.find((message) => message.roundId === roundId && message.role === 'assistant') ?? null)
    const assistantMessageId = existingAssistantMessage?.id ?? dependencies.createId()
    const shouldStreamAssistantMessage = false
    const streamingTaskIds: string[] = []
    const taskIdByToolCallId = new Map<string, string>()

    const attachTaskToAgentRound = (taskId: string) => {
      if (streamingTaskIds.includes(taskId)) return
      streamingTaskIds.push(taskId)
      dependencies.updateConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? {
                ...item,
                outputTaskIds: item.outputTaskIds.includes(taskId)
                  ? item.outputTaskIds
                  : [...item.outputTaskIds, taskId],
              }
            : item,
        ),
        messages: current.messages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, outputTaskIds: [...new Set([...(message.outputTaskIds ?? []), taskId])] }
            : message,
        ),
      }))
    }

    const ensureStreamingAgentTask = async (
      toolCallId: string,
      taskPrompt = '',
      inputImageIds = round.inputImageIds ?? [],
      options: {
        createdAt?: number
        agentBatchCallId?: string
        maskTargetImageId?: string | null
        maskImageId?: string | null
      } = {},
    ) => {
      const existingTaskId = taskIdByToolCallId.get(toolCallId)
      if (existingTaskId) return existingTaskId

      const existingTask = dependencies.getState().tasks.find((task) => task.agentToolCallId === toolCallId)
      if (existingTask) {
        taskIdByToolCallId.set(toolCallId, existingTask.id)
        attachTaskToAgentRound(existingTask.id)
        return existingTask.id
      }

      const task: TaskRecord = {
        id: dependencies.createId(),
        prompt: taskPrompt,
        params: { ...params, n: 1 },
        apiProvider: activeProfile.provider,
        apiProfileId: activeProfile.id,
        apiProfileName: activeProfile.name,
        apiMode: activeProfile.apiMode,
        apiModel: activeProfile.model,
        inputImageIds,
        maskTargetImageId:
          options.maskTargetImageId !== undefined ? options.maskTargetImageId : (round.maskTargetImageId ?? null),
        maskImageId: options.maskImageId !== undefined ? options.maskImageId : (round.maskImageId ?? null),
        outputImages: [],
        status: 'running',
        error: null,
        createdAt: options.createdAt ?? Date.now(),
        finishedAt: null,
        elapsed: null,
        sourceMode: 'agent',
        agentConversationId: conversationId,
        agentRoundId: roundId,
        agentMessageId: assistantMessageId,
        agentToolCallId: toolCallId,
        ...(options.agentBatchCallId ? { agentBatchCallId: options.agentBatchCallId } : {}),
      }

      taskIdByToolCallId.set(toolCallId, task.id)
      dependencies.getState().setTasks([task, ...dependencies.getState().tasks])
      attachTaskToAgentRound(task.id)
      await dependencies.putTask(task)
      return task.id
    }

    const completeAgentImageTask = async (image: AgentApiResultImage, rawResponsePayload?: string) => {
      const toolCallId = image.toolCallId ?? dependencies.createId()
      const taskId = await ensureStreamingAgentTask(toolCallId)
      const latestTask = dependencies.getState().tasks.find((task) => task.id === taskId)
      if (latestTask?.status === 'done' && latestTask.outputImages.length > 0) return taskId

      const imgId = await dependencies.storeImage(image.dataUrl, 'generated')
      dependencies.cacheImage(imgId, image.dataUrl)
      const actualParams: Partial<TaskParams> = {
        ...(Object.keys(image.actualParams ?? {}).length ? image.actualParams : {}),
        n: 1,
      }
      dependencies.updateTask(taskId, {
        prompt: image.revisedPrompt ?? latestTask?.prompt ?? '',
        outputImages: [imgId],
        actualParams,
        actualParamsByImage: { [imgId]: actualParams },
        revisedPromptByImage: image.revisedPrompt ? { [imgId]: image.revisedPrompt } : undefined,
        rawResponsePayload,
        status: 'done',
        error: null,
        finishedAt: Date.now(),
        elapsed: Date.now() - (latestTask?.createdAt ?? startedAt),
        agentToolAction: image.action,
      })
      return taskId
    }

    if (shouldStreamAssistantMessage) {
      dependencies.updateConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) => (item.id === roundId ? { ...item, assistantMessageId } : item)),
        messages: current.messages.some((message) => message.id === assistantMessageId)
          ? current.messages.map((message) =>
              message.id === assistantMessageId ? { ...message, content: '', outputTaskIds: [] } : message,
            )
          : [
              ...current.messages,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                roundId,
                createdAt: Date.now(),
              },
            ],
      }))
    }
    const maxToolCalls = Number.isFinite(requestSettings.agentMaxToolRounds)
      ? Math.max(1, Math.trunc(requestSettings.agentMaxToolRounds))
      : DEFAULT_AGENT_MAX_TOOL_ROUNDS
    let apiInputForTurn = apiInput
    let accumulatedOutputItems: ResponsesOutputItem[] = []
    let accumulatedText = ''
    const textSegments: string[] = []
    let lastResponseId: string | undefined
    let toolCallsUsed = 0
    let reachedToolLimit = false
    let pendingToolTextSeparator = false

    // Helper: resolve reference image ids to data URLs for batch image calls
    const resolveReferenceImages = async (
      referenceIds: string[],
    ): Promise<{ dataUrls: string[]; imageIds: string[] }> => {
      const dataUrls: string[] = []
      const imageIds: string[] = []
      for (const refId of referenceIds) {
        // Try to find the image id from the round's output tasks by matching generated ref ids
        const latestConv = dependencies.getState().agentConversations.find((item) => item.id === conversationId)
        if (!latestConv) continue
        for (const r of getAgentRoundPath(latestConv, roundId)) {
          const outputImages = collectAgentRoundOutputImageSlots(r, dependencies.getState().tasks)
          for (let imgIdx = 0; imgIdx < outputImages.length; imgIdx++) {
            const generatedRefId = getAgentGeneratedImageReferenceId(r, imgIdx)
            if (generatedRefId === refId) {
              const imageId = outputImages[imgIdx]
              if (!imageId) continue
              const dataUrl = await dependencies.ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
        }
      }
      return { dataUrls, imageIds }
    }

    // Helper: execute a generate_image_batch function call concurrently
    const executeBatchFunctionCall = async (functionCallItem: ResponsesOutputItem): Promise<string> => {
      const callId = functionCallItem.call_id ?? ''
      const args = functionCallItem.arguments ?? ''
      const batchItems = parseBatchImageCallArguments(args)

      if (!batchItems || batchItems.length === 0) {
        return JSON.stringify({ error: 'Invalid or empty batch arguments' })
      }

      // Create task cards in model-provided order before starting network calls.
      const batchExecutionItems = []
      for (const item of batchItems) {
        const references = await resolveReferenceImages(item.reference_ids)
        const batchToolCallId = dependencies.createId()
        await ensureStreamingAgentTask(batchToolCallId, item.prompt, references.imageIds, {
          createdAt: Date.now(),
          maskTargetImageId: null,
          maskImageId: null,
          ...(callId ? { agentBatchCallId: callId } : {}),
        })
        batchExecutionItems.push({ item, batchToolCallId, references })
      }

      // Fire all batch items concurrently after all cards are visible.
      const batchPromises = batchExecutionItems.map(async ({ item, batchToolCallId, references }) => {
        const batchResult = await callBatchImageSingle({
          profile: activeProfile,
          params,
          batchItemId: item.id,
          prompt: item.prompt,
          referenceImageDataUrls: references.dataUrls,
          referenceIds: item.reference_ids,
          signal: controller.signal,
          onImageToolStarted: shouldStreamAssistantMessage
            ? async () => {
                if (controller.signal.aborted) return
              }
            : undefined,
          onImageToolCompleted: shouldStreamAssistantMessage
            ? async (image) => {
                if (controller.signal.aborted) return
                await completeAgentImageTask({ ...image, toolCallId: batchToolCallId })
              }
            : undefined,
        })

        // If not streaming and we have an image, complete the pre-created task.
        if (batchResult.image && !shouldStreamAssistantMessage) {
          await completeAgentImageTask(
            { ...batchResult.image, toolCallId: batchToolCallId },
            batchResult.rawResponsePayload,
          )
        }

        return batchResult
      })

      const batchResults = await Promise.allSettled(batchPromises)

      // Build function_call_output
      const outputImages: Array<{ id: string; status: string; error?: string }> = []
      for (let i = 0; i < batchItems.length; i++) {
        const settled = batchResults[i]
        const batchItem = batchItems[i]
        if (settled.status === 'fulfilled') {
          const r = settled.value
          outputImages.push({
            id: r.batchItemId,
            status: r.image ? 'done' : 'error',
            ...(r.error ? { error: r.error } : {}),
          })
        } else {
          outputImages.push({
            id: batchItem.id,
            status: 'error',
            error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
          })
        }
      }

      const successCount = outputImages.filter((img) => img.status === 'done').length
      toolCallsUsed += successCount

      return JSON.stringify({ images: outputImages })
    }

    while (true) {
      if (controller.signal.aborted) throw createAgentAbortError()
      const textBeforeResponse = accumulatedText
      let currentResponseOutputItems: ResponsesOutputItem[] = []
      const result = await callAgentResponsesApi({
        settings: requestSettings,
        profile: activeProfile,
        params,
        input: apiInputForTurn,
        maskDataUrl,
        signal: controller.signal,
        onTextDelta: shouldStreamAssistantMessage
          ? (delta) => {
              if (controller.signal.aborted) return
              if (pendingToolTextSeparator && delta && accumulatedText.trim()) {
                accumulatedText += '\n\n'
                dependencies.appendAssistantMessageContent(conversationId, assistantMessageId, '\n\n')
              }
              pendingToolTextSeparator = false
              accumulatedText += delta
              dependencies.appendAssistantMessageContent(conversationId, assistantMessageId, delta)
            }
          : undefined,
        onOutputItems: shouldStreamAssistantMessage
          ? (outputItems) => {
              if (controller.signal.aborted) return
              currentResponseOutputItems = outputItems
              dependencies.updateConversation(conversationId, (current) => ({
                ...current,
                rounds: current.rounds.map((item) =>
                  item.id === roundId
                    ? {
                        ...item,
                        responseOutput: dependencies.mergeResponseOutputItems(accumulatedOutputItems, outputItems),
                      }
                    : item,
                ),
              }))
            }
          : undefined,
        onImageToolStarted: shouldStreamAssistantMessage
          ? async ({ toolCallId }) => {
              if (controller.signal.aborted) return
              await ensureStreamingAgentTask(toolCallId)
            }
          : undefined,
        onImageToolCompleted: shouldStreamAssistantMessage
          ? async (image) => {
              if (controller.signal.aborted) return
              await completeAgentImageTask(image)
            }
          : undefined,
      })
      if (controller.signal.aborted) throw createAgentAbortError()

      lastResponseId = result.responseId ?? lastResponseId
      currentResponseOutputItems = currentResponseOutputItems.length
        ? currentResponseOutputItems
        : (result.outputItems ?? [])
      accumulatedOutputItems = dependencies.mergeResponseOutputItems(accumulatedOutputItems, currentResponseOutputItems)

      const responseText = result.text.trim()
      if (responseText && accumulatedText === textBeforeResponse) {
        const textToAppend = accumulatedText ? `\n\n${responseText}` : responseText
        accumulatedText += textToAppend
        if (shouldStreamAssistantMessage)
          dependencies.appendAssistantMessageContent(conversationId, assistantMessageId, textToAppend)
      }
      const newTextInThisResponse = accumulatedText.slice(textBeforeResponse.length).trim()
      if (newTextInThisResponse) textSegments.push(newTextInThisResponse)

      // Process built-in image_generation_call results (single images)
      for (const image of result.images) {
        if (image.toolCallId && taskIdByToolCallId.has(image.toolCallId)) {
          await completeAgentImageTask(image, result.rawResponsePayload)
          continue
        }
        const imgId = await dependencies.storeImage(image.dataUrl, 'generated')
        dependencies.cacheImage(imgId, image.dataUrl)
        const actualParams: Partial<TaskParams> = {
          ...(Object.keys(image.actualParams ?? {}).length ? image.actualParams : {}),
          n: 1,
        }
        const task: TaskRecord = {
          id: dependencies.createId(),
          prompt: image.revisedPrompt ?? round?.prompt ?? userMessage.content,
          params,
          apiProvider: activeProfile.provider,
          apiProfileId: activeProfile.id,
          apiProfileName: activeProfile.name,
          apiMode: activeProfile.apiMode,
          apiModel: activeProfile.model,
          inputImageIds: round?.inputImageIds ?? [],
          maskTargetImageId: round?.maskTargetImageId ?? null,
          maskImageId: round?.maskImageId ?? null,
          outputImages: [imgId],
          actualParams,
          actualParamsByImage: { [imgId]: actualParams },
          revisedPromptByImage: image.revisedPrompt ? { [imgId]: image.revisedPrompt } : undefined,
          rawResponsePayload: result.rawResponsePayload,
          status: 'done',
          error: null,
          createdAt: startedAt,
          finishedAt: Date.now(),
          elapsed: Date.now() - startedAt,
          sourceMode: 'agent',
          agentConversationId: conversationId,
          agentRoundId: roundId,
          agentMessageId: assistantMessageId,
          agentToolCallId: image.toolCallId,
          agentToolAction: image.action,
        }
        dependencies.getState().setTasks([task, ...dependencies.getState().tasks])
        attachTaskToAgentRound(task.id)
        await dependencies.putTask(task)
      }

      if (result.rawResponsePayload && streamingTaskIds.length > 0) {
        for (const taskId of streamingTaskIds) {
          const latestTask = dependencies.getState().tasks.find((task) => task.id === taskId)
          if (latestTask && !latestTask.rawResponsePayload)
            dependencies.updateTask(taskId, { rawResponsePayload: result.rawResponsePayload })
        }
      }

      // Check for function calls that require continuation
      const batchFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'generate_image_batch',
      )
      const continueFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'continue_generation',
      )

      // Count built-in tool calls (image_generation, web_search) for budget tracking
      const responseToolCalls = dependencies.countResponseToolCalls(currentResponseOutputItems)
      toolCallsUsed += responseToolCalls

      // Collect function_call_output items for all function calls that need responses
      const functionCallOutputs: ResponsesOutputItem[] = []

      if (batchFunctionCalls.length > 0) {
        for (const fc of batchFunctionCalls) {
          const output = await executeBatchFunctionCall(fc)
          functionCallOutputs.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output,
          })
        }
      }

      for (const fc of continueFunctionCalls) {
        functionCallOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify({ status: 'continued' }),
        })
      }

      // If no function calls need output → model decided the task is done → break
      if (functionCallOutputs.length === 0) {
        dependencies.updateConversation(conversationId, (current) => ({
          ...current,
          updatedAt: Date.now(),
          rounds: current.rounds.map((item) =>
            item.id === roundId
              ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItems }
              : item,
          ),
        }))
        break
      }

      const accumulatedOutputItemsWithFunctionOutputs = dependencies.mergeResponseOutputItems(
        accumulatedOutputItems,
        functionCallOutputs,
      )

      dependencies.updateConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItemsWithFunctionOutputs }
            : item,
        ),
      }))

      if (toolCallsUsed >= maxToolCalls) {
        reachedToolLimit = true
        break
      }

      // Build continuation input with function call outputs and available refs
      const latestConversation = dependencies.getState().agentConversations.find((item) => item.id === conversationId)
      const latestRound = latestConversation?.rounds.find((item) => item.id === roundId)
      if (!latestRound) break

      const continuationBase = dependencies.buildContinuationInput(
        apiInput,
        latestRound,
        dependencies.getState().tasks,
        accumulatedOutputItems,
        toolCallsUsed,
        maxToolCalls,
      )
      continuationBase.splice(continuationBase.length - 1, 0, ...functionCallOutputs)
      apiInputForTurn = continuationBase
      accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs
      pendingToolTextSeparator = true
    }

    const taskIds: string[] = [...streamingTaskIds]
    const outputIds = taskIds.flatMap(
      (taskId) => dependencies.getState().tasks.find((task) => task.id === taskId)?.outputImages ?? [],
    )
    const limitNotice = reachedToolLimit ? `已达到最大工具调用次数（${maxToolCalls}），已停止自动续跑。` : ''
    const joinedText = textSegments.join('\n\n').trim()
    const finalContent =
      [joinedText, limitNotice].filter(Boolean).join(joinedText ? '\n\n' : '') ||
      (taskIds.length > 0 || outputIds.length > 0 ? '图像已生成。' : '')

    const assistantMessage: AgentMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: finalContent,
      roundId,
      outputTaskIds: taskIds,
      createdAt: Date.now(),
    }

    dependencies.updateConversation(conversationId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((round) =>
        round.id === roundId
          ? {
              ...round,
              assistantMessageId,
              outputTaskIds: taskIds,
              responseId: lastResponseId,
              responseOutput: accumulatedOutputItems,
              status: 'done',
              error: null,
              finishedAt: Date.now(),
            }
          : round,
      ),
      messages: current.messages.some((message) => message.id === assistantMessageId)
        ? current.messages.map((message) => (message.id === assistantMessageId ? assistantMessage : message))
        : [...current.messages, assistantMessage],
    }))

    dependencies.getState().showToast(outputIds.length > 0 ? 'Agent 已生成图片' : 'Agent 已回复', 'success')
  } catch (err) {
    if (controller.signal.aborted) {
      if (dependencies.markRoundStopped(conversationId, roundId)) {
        dependencies.getState().showToast('已停止生成', 'info')
      }
      return
    }

    let message = err instanceof Error ? err.message : String(err)
    const usesApiProxy = activeProfile.apiProxy ?? requestSettings.apiProxy
    const networkErrorHint = dependencies.getNetworkErrorHint(err, startedAt, usesApiProxy, activeProfile)
    if (networkErrorHint && !message.includes(IMAGE_FETCH_CORS_HINT)) {
      message += `\n${networkErrorHint}`
    }

    dependencies.updateConversation(conversationId, (current) => {
      const failedRound = current.rounds.find((round) => round.id === roundId)
      const existingAssistantMessage = failedRound?.assistantMessageId
        ? current.messages.find((item) => item.id === failedRound.assistantMessageId)
        : current.messages.find((item) => item.roundId === roundId && item.role === 'assistant')
      const errorContent = `请求失败：${message}`

      return {
        ...current,
        title: current.rounds.length === 1 && current.rounds[0].id === roundId ? '新对话' : current.title,
        updatedAt: Date.now(),
        rounds: current.rounds.map((round) =>
          round.id === roundId
            ? {
                ...round,
                ...(existingAssistantMessage ? { assistantMessageId: existingAssistantMessage.id } : {}),
                status: 'error',
                error: message,
                finishedAt: Date.now(),
              }
            : round,
        ),
        messages: existingAssistantMessage
          ? current.messages.map((item) =>
              item.id === existingAssistantMessage.id ? { ...item, content: errorContent } : item,
            )
          : [
              ...current.messages,
              {
                id: dependencies.createId(),
                role: 'assistant',
                content: errorContent,
                roundId,
                createdAt: Date.now(),
              },
            ],
      }
    })
    dependencies.getState().showToast(`Agent 请求失败：${message}`, 'error')
  } finally {
    if (legacyAgentRoundControllers.get(controllerKey) === controller) {
      legacyAgentRoundControllers.delete(controllerKey)
    }
  }
}
