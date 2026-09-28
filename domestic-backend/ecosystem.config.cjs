module.exports = {
  apps: [
    {
      name: 'huozhema-api',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
      max_memory_restart: '300M',
      time: true,
    },
  ],
};
