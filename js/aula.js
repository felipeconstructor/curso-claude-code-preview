// Aula del curso: temario, reproductor protegido, progreso, sesión única y acceso de 1 año.
(async function () {
  const C = window.CURSO;
  const { sb, registrarSesion, sesionLocal } = window.CursoCliente;
  const $ = (id) => document.getElementById(id);
  const video = $("video");

  let usuario = null;      // { id, email, nombre }
  let hasta = null;        // Date
  let lecciones = [];      // [{ id, modulo, modulo_titulo, titulo, minutos, orden, tarea, publicada }]
  const progreso = {};     // leccion_id → { segundos, completada }
  let actual = null;
  let hls = null;

  // ------------------------------------------------------------ datos
  function leccionesDemo() {
    const filas = [];
    let orden = 1;
    window.TEMARIO.forEach(([m, t, , ls]) => ls.forEach(([n, min], j) => filas.push({
      id: `${m.slice(1)}.${j + 1}`, modulo: m, modulo_titulo: t, titulo: n, minutos: min, orden: orden++,
      publicada: m === "M0" || m === "M1",
      tarea: j === 0 && m === "M0" ? "Abre una nota y escribe: tu nombre, qué problema quieres resolver y para quién." : null,
    })));
    return filas;
  }

  async function cargar() {
    if (C.DEMO) {
      $("demo").hidden = false;
      usuario = { id: "demo", email: "alumno@ejemplo.cl", nombre: "Alumno demo" };
      hasta = new Date(Date.now() + 300 * 864e5);
      lecciones = leccionesDemo();
      ["0.1", "0.2", "1.1"].forEach((id) => (progreso[id] = { segundos: 0, completada: true }));
      return true;
    }

    const { data: s } = await sb.auth.getSession();
    if (!s.session) { location.replace("entrar.html"); return false; }
    const u = s.session.user;
    if (!sesionLocal()) await registrarSesion(u.id);

    const [{ data: acc }, { data: al }] = await Promise.all([
      sb.from("accesos").select("hasta, estado").eq("estado", "activo").order("hasta", { ascending: false }).limit(1),
      sb.from("alumnos").select("nombre").eq("user_id", u.id).maybeSingle(),
    ]);
    usuario = { id: u.id, email: u.email, nombre: (al && al.nombre) || "" };
    hasta = acc && acc.length ? new Date(acc[0].hasta) : null;
    if (!hasta || hasta < new Date()) { mostrarVencido(); return false; }

    const [{ data: ls, error }, { data: pr }] = await Promise.all([
      sb.from("lecciones").select("id, modulo, modulo_titulo, titulo, minutos, orden, tarea, publicada").order("orden"),
      sb.from("progreso").select("leccion_id, segundos, completada_en"),
    ]);
    if (error) { console.error(error); mostrarVencido(); return false; }
    lecciones = ls;
    (pr || []).forEach((p) => (progreso[p.leccion_id] = { segundos: p.segundos, completada: !!p.completada_en }));
    return true;
  }

  async function guardarProgreso(id, cambios) {
    progreso[id] = { ...(progreso[id] || { segundos: 0, completada: false }), ...cambios };
    if (C.DEMO) return;
    const fila = { user_id: usuario.id, leccion_id: id, segundos: Math.floor(progreso[id].segundos), actualizado: new Date().toISOString() };
    if (cambios.completada) fila.completada_en = new Date().toISOString();
    const { error } = await sb.from("progreso").upsert(fila);
    if (error) console.error("progreso", error);
  }

  // ------------------------------------------------------------ pantallas
  function fecha(d) { return d.toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }); }

  function mostrarVencido() {
    $("cargando").hidden = true;
    $("vencido").hidden = false;
    if (hasta) $("vencido-texto").textContent = `Tu acceso estuvo vigente hasta el ${fecha(hasta)}. Si quieres volver a ver el curso, puedes renovarlo por un año más.`;
  }

  function capa(html) {
    const c = $("capa");
    if (!html) { c.hidden = true; c.innerHTML = ""; return; }
    c.innerHTML = `<div>${html}</div>`;
    c.hidden = false;
  }

  function avance() {
    const hechas = lecciones.filter((l) => progreso[l.id] && progreso[l.id].completada).length;
    const pct = lecciones.length ? Math.round((hechas / lecciones.length) * 100) : 0;
    $("pct").textContent = `${pct}%`;
    $("avance-texto").textContent = `${hechas} de ${lecciones.length} lecciones`;
    $("barra").style.width = `${pct}%`;
  }

  function pintarTemario() {
    const modulos = [];
    lecciones.forEach((l) => {
      let m = modulos.find((x) => x.m === l.modulo);
      if (!m) modulos.push((m = { m: l.modulo, t: l.modulo_titulo, ls: [] }));
      m.ls.push(l);
    });
    $("lista").innerHTML = modulos.map((m) => {
      const hechas = m.ls.filter((l) => progreso[l.id] && progreso[l.id].completada).length;
      const abierto = actual && m.ls.some((l) => l.id === actual.id);
      return `<details class="modulo"${abierto ? " open" : ""}>
        <summary><span class="m">${m.m}</span><span class="t">${esc(m.t)}</span><span class="c">${hechas}/${m.ls.length}</span></summary>
        <ul>${m.ls.map((l) => {
          const hecha = progreso[l.id] && progreso[l.id].completada;
          const clase = ["leccion", hecha ? "hecha" : "", l.publicada ? "" : "pronto"].join(" ");
          return `<li><button class="${clase}" data-id="${l.id}"${actual && actual.id === l.id ? ' aria-current="true"' : ""}>
            <span class="ico">${hecha ? "✓" : ""}</span><span>${l.id} — ${esc(l.titulo)}${l.publicada ? "" : " · próximamente"}</span><span class="min">${l.minutos}′</span></button></li>`;
        }).join("")}</ul></details>`;
    }).join("");
    avance();
  }

  function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

  // ------------------------------------------------------------ reproductor
  async function pedirVideo(id) {
    const { data } = await sb.auth.getSession();
    if (!data.session) { location.replace("entrar.html"); return null; }
    const r = await fetch(`${C.VIDEOS_URL}/api/leccion`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session.access_token}`, "x-sesion": sesionLocal() },
      body: JSON.stringify({ id }),
    });
    const cuerpo = await r.json().catch(() => ({}));
    if (r.ok) return cuerpo.playlist;
    if (cuerpo.error === "otra_sesion") otraSesion();
    else if (cuerpo.error === "acceso_vencido") mostrarVencido();
    else if (cuerpo.error === "sin_sesion") location.replace("entrar.html");
    else if (cuerpo.error === "no_publicada") capa(`<p class="etiqueta">Próximamente</p><h2>Esta lección aún no se publica</h2><p>Te avisamos por correo cuando esté disponible.</p>`);
    else capa(`<p class="etiqueta">Ups</p><h2>No pudimos cargar el video</h2><p>Revisa tu conexión y vuelve a intentar.</p><button class="btn" onclick="location.reload()">Reintentar</button>`);
    return null;
  }

  function detenerVideo() {
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute("src");
    video.load();
  }

  async function abrir(id, { reproducir = false } = {}) {
    const l = lecciones.find((x) => x.id === id) || lecciones[0];
    if (actual && actual.id !== l.id && video.currentTime > 0) guardarProgreso(actual.id, { segundos: video.currentTime });
    actual = l;
    history.replaceState(null, "", `#${l.id}`);
    $("l-modulo").innerHTML = `<b>${l.modulo}</b> · ${esc(l.modulo_titulo)} · ${l.minutos} min`;
    $("l-titulo").textContent = `${l.id} ${l.titulo}`;
    $("tarea").hidden = !l.tarea;
    $("tarea-texto").textContent = l.tarea || "";
    const idx = lecciones.indexOf(l);
    $("anterior").disabled = idx === 0;
    $("siguiente").innerHTML = idx === lecciones.length - 1 ? "Marcar como vista ✓" : 'Marcar como vista y seguir <span aria-hidden="true">→</span>';
    pintarTemario();
    $("temario").classList.remove("abierto");
    $("abrir-temario").setAttribute("aria-expanded", "false");
    detenerVideo();
    capa(null);

    if (!l.publicada) {
      capa(`<p class="etiqueta">Próximamente</p><h2>Esta lección aún no se publica</h2><p>Estamos grabando el curso por lotes. Te avisamos por correo cuando esté disponible.</p>`);
      return;
    }
    if (C.DEMO) {
      capa(`<p class="etiqueta">Modo demo</p><h2>Aquí se reproduce la lección ${l.id}</h2><p>Cuando conectes Supabase y el Worker de videos, este recuadro muestra el video protegido.</p>`);
      return;
    }
    capa(`<p class="etiqueta">Cargando video…</p>`);
    const url = await pedirVideo(l.id);
    if (!url || actual !== l) return;
    capa(null);

    const inicio = progreso[l.id] && !progreso[l.id].completada ? progreso[l.id].segundos : 0;
    video.addEventListener("loadedmetadata", function retomar() {
      if (inicio > 5 && inicio < video.duration - 10) video.currentTime = inicio;
      video.playbackRate = velocidad;
      if (reproducir) video.play().catch(() => {});
    }, { once: true });

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30 });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) { detenerVideo(); capa(`<p class="etiqueta">Sesión del video vencida</p><h2>Vuelve a cargar la lección</h2><p>Por seguridad, cada enlace dura unas horas.</p><button class="btn" id="recargar">Cargar de nuevo</button>`); $("recargar").onclick = () => abrir(l.id, { reproducir: true }); }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url; // Safari / iPhone reproducen HLS de forma nativa
    }
  }

  // Guardar posición cada 15 segundos y al pausar
  let ultimoGuardado = 0;
  video.addEventListener("timeupdate", () => {
    if (!actual || Date.now() - ultimoGuardado < 15000) return;
    ultimoGuardado = Date.now();
    guardarProgreso(actual.id, { segundos: video.currentTime });
  });
  video.addEventListener("pause", () => actual && video.currentTime > 0 && guardarProgreso(actual.id, { segundos: video.currentTime }));
  video.addEventListener("ended", async () => {
    await guardarProgreso(actual.id, { segundos: 0, completada: true });
    pintarTemario();
  });

  // Velocidad
  let velocidad = 1;
  try { velocidad = Number(localStorage.getItem("curso_velocidad")) || 1; } catch { /* sin almacenamiento */ }
  document.querySelectorAll(".velocidad button").forEach((b) => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.v) === velocidad));
    b.addEventListener("click", () => {
      velocidad = Number(b.dataset.v);
      video.playbackRate = velocidad;
      try { localStorage.setItem("curso_velocidad", String(velocidad)); } catch { /* sin almacenamiento */ }
      document.querySelectorAll(".velocidad button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
  });

  // Marca de agua con el correo del alumno, cambia de lugar cada 20 s
  function moverMarca() {
    const m = $("marca-agua");
    m.textContent = usuario.email;
    m.style.top = `${8 + Math.random() * 74}%`;
    m.style.left = `${4 + Math.random() * 60}%`;
  }

  // ------------------------------------------------------------ sesión única
  function otraSesion() {
    video.pause();
    detenerVideo();
    capa(`<p class="etiqueta">Sesión cerrada aquí</p><h2>Tu cuenta se abrió en otro dispositivo</h2><p>El acceso es personal y funciona en un dispositivo a la vez.</p><button class="btn" id="usar-aqui">Seguir viendo aquí</button>`);
    $("usar-aqui").onclick = async () => { await registrarSesion(usuario.id); abrir(actual.id, { reproducir: true }); };
  }
  async function revisarSesion() {
    if (C.DEMO || document.hidden) return;
    const { data } = await sb.from("sesion_activa").select("sesion_id").maybeSingle();
    if (data && data.sesion_id !== sesionLocal()) otraSesion();
  }

  // ------------------------------------------------------------ eventos
  $("lista").addEventListener("click", (e) => {
    const b = e.target.closest(".leccion");
    if (b) abrir(b.dataset.id, { reproducir: true });
  });
  $("anterior").addEventListener("click", () => {
    const i = lecciones.indexOf(actual);
    if (i > 0) abrir(lecciones[i - 1].id, { reproducir: true });
  });
  $("siguiente").addEventListener("click", async () => {
    await guardarProgreso(actual.id, { segundos: 0, completada: true });
    const i = lecciones.indexOf(actual);
    if (i < lecciones.length - 1) abrir(lecciones[i + 1].id, { reproducir: true });
    else pintarTemario();
  });
  $("abrir-temario").addEventListener("click", () => {
    const abierto = $("temario").classList.toggle("abierto");
    $("abrir-temario").setAttribute("aria-expanded", String(abierto));
  });
  $("salir").addEventListener("click", async () => {
    if (actual && video.currentTime > 0) await guardarProgreso(actual.id, { segundos: video.currentTime });
    if (!C.DEMO) await sb.auth.signOut();
    location.href = "entrar.html";
  });
  $("btn-pdf").addEventListener("click", async () => {
    if (C.DEMO) { alertaSuave("En modo demo no hay PDF. Con la plataforma conectada se descarga aquí."); return; }
    const { data } = await sb.auth.getSession();
    const r = await fetch(`${C.VIDEOS_URL}/api/material`, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session.access_token}`, "x-sesion": sesionLocal() },
    });
    const cuerpo = await r.json().catch(() => ({}));
    if (r.ok) location.href = cuerpo.url;
    else if (cuerpo.error === "otra_sesion") otraSesion();
    else alertaSuave("No pudimos preparar el PDF. Intenta de nuevo.");
  });
  function alertaSuave(texto) { $("btn-pdf").textContent = texto.length > 40 ? "No disponible en demo" : texto; setTimeout(() => ($("btn-pdf").textContent = "PDF del curso"), 2500); }

  // ------------------------------------------------------------ inicio
  if (!(await cargar())) return;
  $("cargando").hidden = true;
  $("aula").hidden = false;
  $("hola").innerHTML = `Hola${usuario.nombre ? `, <b>${esc(usuario.nombre.split(" ")[0])}</b>` : ""} · acceso hasta el ${fecha(hasta)}`;
  moverMarca();
  setInterval(moverMarca, 20000);
  setInterval(revisarSesion, 60000);
  document.addEventListener("visibilitychange", revisarSesion);

  const pedida = decodeURIComponent(location.hash.slice(1));
  const siguientePendiente = lecciones.find((l) => l.publicada && !(progreso[l.id] && progreso[l.id].completada));
  abrir(lecciones.some((l) => l.id === pedida) ? pedida : (siguientePendiente || lecciones[0]).id);
})();
