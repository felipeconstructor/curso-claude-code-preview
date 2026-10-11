// ============================================================
// CONFIGURACIÓN DE LA PLATAFORMA
// Mientras estos valores estén vacíos, entrar.html y aula.html
// funcionan en MODO DEMO (sin login real, sin videos) para revisar el diseño.
// ============================================================
window.CURSO = {
  SUPABASE_URL: "",       // https://xxxx.supabase.co
  SUPABASE_ANON_KEY: "",  // clave pública (anon / publishable). Nunca la service role.
  VIDEOS_URL: "",         // URL del Worker, ej: https://curso-videos.tu-cuenta.workers.dev
  CONTACTO: "",           // correo de soporte, ej: curso@tu-dominio
};
window.CURSO.DEMO = !window.CURSO.SUPABASE_URL;
