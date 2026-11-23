import type { InputImage } from '../../types'
import { CloseIcon } from '../icons'

type PlannerReferenceImageGridProps = {
  images: InputImage[]
  onRemove: (index: number) => void
  disabled?: boolean
}

export default function PlannerReferenceImageGrid({
  images,
  onRemove,
  disabled = false,
}: PlannerReferenceImageGridProps) {
  return (
    <div className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,80px)]">
      {images.map((image, index) => (
        <div
          key={image.id}
          className="group relative aspect-square overflow-hidden rounded-xl bg-[var(--surface-solid)] shadow-[0_0_0_1px_var(--line),0_4px_12px_-6px_rgb(15_23_42/0.18)] transition hover:shadow-[0_0_0_1px_var(--accent-ring),0_8px_18px_-8px_rgb(79_70_229/0.3)]"
        >
          <img
            src={image.dataUrl}
            alt={`参考图 ${index + 1}`}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
          <span className="absolute bottom-1.5 left-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/65 px-1.5 text-[10px] font-bold text-white backdrop-blur-sm">
            {index + 1}
          </span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={disabled}
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-100 backdrop-blur-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100"
            aria-label={`删除参考图 ${index + 1}`}
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
