# Agent Legacy Notes

Agent is now treated as a legacy experimental feature.

It is not mounted in the current main app shell and should not be used as the default direction for new work. The current product path is the gallery/image generation workspace plus the standalone planning workspaces.

The code is still retained for compatibility:

- Old persisted Agent conversations can still be normalized, imported, exported, and cleaned up.
- Old Agent task records can still be classified and displayed in history.
- Existing tests around Agent data compatibility remain useful until the data format is retired.

Mainline boundaries:

- `InputBar` must submit through the normal image-generation path only.
- Agent API calls must stay lazy-loaded and run only from explicit legacy Agent store actions.
- Do not re-add Agent navigation or mount `AgentWorkspace` without first moving it into a separate, reviewed workspace/module.

