import type { InputImage } from '../../types'
import { CloseIcon } from '../icons'

type PlannerReferenceImageGridProps = {
  images: InputImage[]
  onRemove: (index: number) => void
}

export default function PlannerReferenceImageGrid({ images, onRemove }: PlannerReferenceImageGridProps) {
  return (
    <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,72px)]">
      {images.map((image, index) => (
        <div
          key={image.id}
          className="group relative aspect-square overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-gray-900"
        >
          <img src={image.dataUrl} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" />
          <span className="absolute bottom-1 left-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/60 px-1.5 text-[10px] font-semibold text-white">
            {index + 1}
          </span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-100 transition hover:bg-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            aria-label={`删除参考图 ${index + 1}`}
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
