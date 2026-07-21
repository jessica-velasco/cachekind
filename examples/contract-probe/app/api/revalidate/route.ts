import { revalidateTag } from 'next/cache'

export async function POST() {
  revalidateTag('probe-data', 'max')
  return Response.json({ revalidated: true })
}

