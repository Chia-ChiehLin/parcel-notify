// src/server.js —— 本機開發用（npm start）。正式環境在 Vercel 上跑 api/index.js。
import app from './app.js';

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
