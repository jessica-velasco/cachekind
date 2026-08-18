import { unstable_cache } from 'next/cache'

const readSharedValue = unstable_cache(
  async () => ({ value: 'shared-fetch-value', generatedAt: Date.now() }),
  ['contract-probe-value'],
  { revalidate: 60, tags: ['probe-data'] },
)

export const revalidate = 60

export default async function Home() {
  const result = await readSharedValue()

  return (
    <main>
      <h1>Cache handler contract probe</h1>
      <p data-testid="value">{result.value}</p>
      <p data-testid="generated-at">{result.generatedAt}</p>
    </main>
  )
}

