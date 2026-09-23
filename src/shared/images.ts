const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export function isImageFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return false
  return IMAGE_EXTENSIONS.has(fileName.slice(dot).toLowerCase())
}
