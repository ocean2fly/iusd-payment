module.exports = {
  apps: [
    {
      name: 'ipay-api',
      script: './packages/api/dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
      autorestart: true,
      watch: false,
    },
    {
      name: 'ipay-app',
      script: './serve-static.cjs',
      env: {
        PORT: '3201',
      },
      autorestart: true,
      watch: false,
    },
  ],
}
