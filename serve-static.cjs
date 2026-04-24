const express = require('express')
const path = require('path')

const app = express()
const PORT = parseInt(process.env.PORT || '3201', 10)
const STATIC_DIR = process.env.FRONTEND_RUNTIME_DIR
  || (process.env.DEPLOY_BASE_DIR
    ? `${process.env.DEPLOY_BASE_DIR}/frontend`
    : '/home/jack_initia_xyz/ipay-deploy/frontend')

// 禁用缓存
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  next()
})

// 静态文件
app.use(express.static(STATIC_DIR))

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Static server running on http://localhost:${PORT}`)
  console.log(`Serving from: ${STATIC_DIR}`)
})
