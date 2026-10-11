// Cliente de Supabase + sesión única (lo usan entrar.html y aula.html).
(function () {
  const C = window.CURSO;
  const sb = C.DEMO ? null : window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  function leerSesionLocal() {
    try { return localStorage.getItem("curso_sesion") || ""; } catch { return ""; }
  }

  // Marca este navegador como la sesión activa del alumno (el último en entrar gana).
  async function registrarSesion(userId) {
    const id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2) + Date.now();
    try { localStorage.setItem("curso_sesion", id); } catch { /* modo privado: igual funciona en esta pestaña */ }
    window.__cursoSesion = id;
    const { error } = await sb.from("sesion_activa").upsert({ user_id: userId, sesion_id: id, actualizado: new Date().toISOString() });
    if (error) console.error("sesion_activa", error);
    return id;
  }

  function sesionLocal() {
    return window.__cursoSesion || leerSesionLocal();
  }

  window.CursoCliente = { sb, registrarSesion, sesionLocal };
})();
