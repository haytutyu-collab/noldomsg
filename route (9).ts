import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import sharp from 'sharp'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const SESSION_COOKIE = 'noldo_user_id'
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

// POST /api/upload?type=avatar|attachment|audio
// Multipart form data with field "file".
// - avatar: image, resized to 256x256 (cover) JPEG
// - attachment: image, resized to max 1280px keeping aspect ratio
// - audio: audio file (webm/ogg/mp3/wav), saved as-is
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const userId = cookieStore.get(SESSION_COOKIE)?.value
    if (!userId) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const rawKind = searchParams.get('type')
    const kind: 'avatar' | 'attachment' | 'audio' =
      rawKind === 'attachment' || rawKind === 'audio' ? rawKind : 'avatar'

    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Файл слишком большой (макс. 10 МБ)' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    let out: Buffer
    let ext: string
    let contentType: string

    if (kind === 'audio') {
      if (!file.type.startsWith('audio/')) {
        return NextResponse.json({ error: 'Ожидался аудиофайл' }, { status: 400 })
      }
      // Save the audio as-is. Keep the original extension based on MIME type.
      out = buf
      const map: Record<string, { ext: string; ct: string }> = {
        'audio/webm': { ext: 'webm', ct: 'audio/webm' },
        'audio/ogg': { ext: 'ogg', ct: 'audio/ogg' },
        'audio/mp3': { ext: 'mp3', ct: 'audio/mpeg' },
        'audio/mpeg': { ext: 'mp3', ct: 'audio/mpeg' },
        'audio/wav': { ext: 'wav', ct: 'audio/wav' },
        'audio/x-wav': { ext: 'wav', ct: 'audio/wav' },
        'audio/mp4': { ext: 'm4a', ct: 'audio/mp4' },
        'audio/x-m4a': { ext: 'm4a', ct: 'audio/mp4' },
      }
      const found = map[file.type] ?? { ext: 'webm', ct: file.type || 'audio/webm' }
      ext = found.ext
      contentType = found.ct
    } else {
      if (!file.type.startsWith('image/')) {
        return NextResponse.json({ error: 'Только изображения разрешены' }, { status: 400 })
      }
      if (kind === 'avatar') {
        out = await sharp(buf)
          .resize(256, 256, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 85 })
          .toBuffer()
      } else {
        out = await sharp(buf)
          .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer()
      }
      ext = 'jpg'
      contentType = 'image/jpeg'
    }

    await mkdir(UPLOAD_DIR, { recursive: true })
    const filename = `${userId}-${randomUUID()}.${ext}`
    const filepath = path.join(UPLOAD_DIR, filename)
    await writeFile(filepath, out)

    const url = `/uploads/${filename}`
    return NextResponse.json({ url, contentType })
  } catch (e) {
    console.error('[upload] error', e)
    return NextResponse.json({ error: 'Не удалось обработать файл' }, { status: 500 })
  }
}
