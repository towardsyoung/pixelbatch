import { describe, expect, it } from 'vitest'
import { parseGeminiImageResponse, parseOpenAiImageResponse } from '../src/main/providers'

describe('provider response parsing', () => {
  it('reads OpenAI base64 images', () => {
    const result = parseOpenAiImageResponse({
      data: [{ b64_json: Buffer.from('openai').toString('base64') }]
    })
    expect(result?.data.toString()).toBe('openai')
  })

  it('finds an image among Gemini response parts', () => {
    const result = parseGeminiImageResponse({
      candidates: [
        {
          content: {
            parts: [
              { text: 'done' },
              {
                inlineData: {
                  mimeType: 'image/webp',
                  data: Buffer.from('gemini').toString('base64')
                }
              }
            ]
          }
        }
      ]
    })
    expect(result?.data.toString()).toBe('gemini')
    expect(result?.mimeType).toBe('image/webp')
  })
})
