#!/usr/bin/env node
/**
 * 本地 mock OpenAI 兼容 image API（C-2）。
 *
 * 启动：
 *   node scripts/mock-image-api.mjs [--port 8787]
 *
 * 然后在 settings 里把 API URL 改成 http://localhost:8787 即可不消耗真实额度调试。
 *
 * 支持的端点：
 *   POST /v1/images/generations       —— Images API 文生图
 *   POST /v1/images/edits             —— Images API edits（含 mask 上传）
 *   POST /v1/responses                —— Responses API（带 image_generation tool）
 *
 * 每次返回一张 32x32 占位 PNG（B64 inline），并随机改写 prompt / size，便于验证：
 *   - A-4：actualParams 与 requested 不一致徽章
 *   - A-5：revised_prompt
 *   - A-2：raw_response_payload 可查看
 */
import http from 'node:http'
import { Buffer } from 'node:buffer'

const port = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || process.argv[process.argv.indexOf('--port') + 1] || 8787)

// 32x32 纯蓝 PNG，已经 base64 化（避免引入依赖）
const PLACEHOLDER_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOklEQVRYhe3OQQ0AIAwAQfh/0SrhEYg2Ps5Mbpe8m5kzZ4QRgFiABYgFWIBYgAWIBViABYgFiAVYgFiABRzhBQHpAhf9KkrqAAAAAElFTkSuQmCC'

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function maybeRewritePrompt(prompt) {
  // 30% 概率"改写"，模拟上游 prompt rewrite
  if (Math.random() > 0.3) return null
  return `[MOCK-REWRITE] ${prompt} (enhanced, cinematic lighting, ultra detail)`
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function isMultipart(req) {
  const ct = req.headers['content-type'] || ''
  return ct.startsWith('multipart/form-data')
}

function parseMultipartPromptAndSize(buffer, boundary) {
  const fields = {}
  const sep = `--${boundary}`
  const parts = buffer.toString('latin1').split(sep)
  for (const part of parts) {
    const match = part.match(/Content-Disposition: form-data; name="([^"]+)"\r\n(?:Content-Type:[^\r\n]+\r\n)?\r\n([\s\S]*?)\r\n$/)
    if (match) {
      fields[match[1]] = match[2]
    }
  }
  return fields
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders())
    res.end()
    return
  }

  const url = new URL(req.url, `http://localhost:${port}`)
  console.log(`[mock] ${req.method} ${url.pathname}`)

  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...corsHeaders() })
    res.end('Not found')
    return
  }

  try {
    if (url.pathname === '/v1/images/generations' || url.pathname === '/v1/images/edits') {
      let prompt = '(mock)'
      let requestedSize = '1024x1024'
      let n = 1

      if (isMultipart(req)) {
        const ct = req.headers['content-type'] || ''
        const boundary = ct.match(/boundary=([^;]+)/)?.[1]
        const body = await readBody(req)
        const fields = boundary ? parseMultipartPromptAndSize(body, boundary) : {}
        prompt = fields.prompt || prompt
        requestedSize = fields.size || requestedSize
        n = Number(fields.n) || 1
      } else {
        const json = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        prompt = json.prompt || prompt
        requestedSize = json.size || requestedSize
        n = Number(json.n) || 1
      }

      // 模拟 actualParams 偏离：50% 概率改 size
      const actualSize = Math.random() > 0.5 ? randomChoice(['1024x1024', '512x512', '2048x2048']) : requestedSize
      const revised = maybeRewritePrompt(prompt)

      const data = []
      for (let i = 0; i < n; i++) {
        data.push({
          b64_json: PLACEHOLDER_PNG_B64,
          revised_prompt: revised || undefined,
        })
      }

      const payload = {
        created: Math.floor(Date.now() / 1000),
        data,
        size: actualSize,
        quality: 'standard',
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() })
      res.end(JSON.stringify(payload))
      return
    }

    if (url.pathname === '/v1/responses') {
      const json = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const inputText = typeof json.input === 'string'
        ? json.input
        : Array.isArray(json.input)
          ? (json.input[0]?.content?.find?.((c) => c.type === 'input_text')?.text || '(mock)')
          : '(mock)'
      const tool = (json.tools || []).find((t) => t.type === 'image_generation') || {}
      const requestedSize = tool.size || '1024x1024'
      const actualSize = Math.random() > 0.5 ? randomChoice(['1024x1024', '512x512', '2048x2048']) : requestedSize
      const revised = maybeRewritePrompt(inputText)

      const payload = {
        id: `resp_mock_${Date.now()}`,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        output: [
          {
            type: 'image_generation_call',
            id: `img_${Date.now()}`,
            result: PLACEHOLDER_PNG_B64,
            size: actualSize,
            quality: tool.quality || 'standard',
            output_format: tool.output_format || 'png',
            revised_prompt: revised || undefined,
          },
        ],
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() })
      res.end(JSON.stringify(payload))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders() })
    res.end(JSON.stringify({ error: { message: `Not implemented: ${url.pathname}` } }))
  } catch (err) {
    console.error('[mock] error', err)
    res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders() })
    res.end(JSON.stringify({ error: { message: err.message } }))
  }
})

server.listen(port, () => {
  console.log(`[mock] OpenAI-compatible mock listening on http://localhost:${port}`)
  console.log('[mock] Endpoints:')
  console.log('  POST /v1/images/generations')
  console.log('  POST /v1/images/edits')
  console.log('  POST /v1/responses')
})
