module.exports = {
  apps: [
    {
      name: 'lokaApps',
      script: 'server.js',
      cwd: __dirname,
      interpreter_args: '--env-file=.env',
      autorestart: true,
      max_memory_restart: '256M',
    },
  ],
};
