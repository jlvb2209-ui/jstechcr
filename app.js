import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    initializeFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    orderBy,
    limit,
    onSnapshot,
    writeBatch,
    arrayUnion,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBHdtd1YLq8z_cuVgUDx33Z088okq0Sriw",
    authDomain: "servicio-tecnico-1d91f.firebaseapp.com",
    projectId: "servicio-tecnico-1d91f",
    storageBucket: "servicio-tecnico-1d91f.firebasestorage.app",
    messagingSenderId: "475926146823",
    appId: "1:475926146823:web:1bd26d301c1ad0d25f5fa2"
};

const CONFIG = {
    prefijo: "506",
    baseUrl: "https://jstech.co.cr/"
};

const URL_GOOGLE_DRIVE = "https://script.google.com/macros/s/AKfycbw37r2nI4NiFB2tlE9K31RTFY7fSh30mBMOVlnpGAn0qEow65hztlfxSzVSudGgf2cH1Q/exec";

const ESTADOS = [
    "Recibido",
    "En diagnóstico",
    "Esperando repuesto",
    "En reparación",
    "Listo para entrega",
    "Entregado"
];

// Sin procedimientos base fijos: solo se cargan los agregados por el usuario en localStorage
const STORAGE_KEY_PROCEDIMIENTOS = "jstech_procedimientos_personalizados_v1";

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
    experimentalForceLongPolling: true
});
const auth = getAuth(app);
const $ = id => document.getElementById(id);

let unsubscribe = null;
let dispositivos = [];
let contactosMap = {};
let operacionEnCurso = false;
let versionDetalle = 0;

function obtenerProcedimientosPersonalizados() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PROCEDIMIENTOS);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        const limpios = [];
        const vistos = new Set();
        for (const item of parsed) {
            const texto = String(item ?? "").trim();
            if (!texto) continue;
            const clave = texto.toLowerCase();
            if (!vistos.has(clave)) {
                vistos.add(clave);
                limpios.push(texto);
            }
        }
        return limpios;
    } catch (error) {
        console.warn("No se pudieron leer los procedimientos personalizados:", error);
        return [];
    }
}

function guardarProcedimientosPersonalizados(lista) {
    try {
        localStorage.setItem(STORAGE_KEY_PROCEDIMIENTOS, JSON.stringify(lista));
    } catch (error) {
        console.warn("No se pudieron guardar los procedimientos personalizados:", error);
    }
}

function escapar(valor) {
    const div = document.createElement("div");
    div.textContent = String(valor ?? "");
    return div.innerHTML.replace(/"/g, "\u0026quot;").replace(/'/g, "\u0026#39;");
}

function formatearFecha(fecha) {
    if (!fecha) return "Fecha no disponible";
    const fechaReal = typeof fecha === "number"
        ? new Date(fecha)
        : fecha.toDate
            ? fecha.toDate()
            : new Date(fecha);
    if (Number.isNaN(fechaReal.getTime())) {
        return "Fecha no disponible";
    }
    return fechaReal.toLocaleString("es-CR", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function mostrarMensaje(contenedor, mensaje, tipo = "") {
    const el = $(contenedor);
    if (!el) return;
    el.innerHTML = `
        <div class="message ${tipo}">
            ${escapar(mensaje)}
        </div>
    `;
}

function obtenerEstadoSeguro(estado) {
    const indice = ESTADOS.indexOf(estado);
    return indice >= 0 ? indice : 0;
}

function insignia(estado) {
    return `
        <span class="badge status-${obtenerEstadoSeguro(estado)}">
            ${escapar(estado || ESTADOS[0])}
        </span>
    `;
}

function insigniaPrioridad(prioridad) {
    const tipoPrio = prioridad === "Urgente" ? "prio-urgente" : "prio-normal";
    return `
        <span class="badge-prio ${tipoPrio}">
            ${escapar(prioridad || "Normal")}
        </span>
    `;
}

function generarCodigo() {
    const caracteres = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let codigo = "RP-";
    for (let i = 0; i < 6; i++) {
        codigo += caracteres[
            Math.floor(Math.random() * caracteres.length)
        ];
    }
    return codigo;
}

function enlaceCliente(codigo) {
    const url = new URL(CONFIG.baseUrl);
    url.searchParams.set("c", codigo);
    return url.href;
}

async function copiarTexto(texto) {
    try {
        await navigator.clipboard.writeText(texto);
        alert("Copiado correctamente.");
    } catch {
        window.prompt("Copia este texto:", texto);
    }
}

function establecerCarga(boton, cargando, textoOriginal) {
    if (!boton) return;
    boton.disabled = cargando;
    boton.textContent = cargando ? "Procesando..." : textoOriginal;
}

/* =========================
   INICIO DE SESIÓN
========================= */
const loginForm = $("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async evento => {
        evento.preventDefault();
        const boton = $("bl");
        establecerCarga(boton, true, "Entrar al panel");
        const le = $("le");
        if (le) le.innerHTML = "";
        try {
            await signInWithEmailAndPassword(
                auth,
                $("em").value.trim(),
                $("pw").value
            );
        } catch (error) {
            const mensajes = {
                "auth/invalid-credential": "Correo o contraseña incorrectos.",
                "auth/wrong-password": "Correo o contraseña incorrectos.",
                "auth/user-not-found": "El usuario no existe en Firebase Authentication.",
                "auth/invalid-email": "El correo electrónico no es válido.",
                "auth/operation-not-allowed": "Activa el acceso por correo y contraseña en Firebase.",
                "auth/unauthorized-domain": "Autoriza este dominio en Firebase Authentication.",
                "auth/network-request-failed": "Error de conexión. Revisa tu Internet.",
                "auth/too-many-requests": "Demasiados intentos. Espera antes de volver a probar."
            };
            mostrarMensaje(
                "le",
                mensajes[error.code] || `No se pudo iniciar sesión: ${error.message}`,
                "error"
            );
        } finally {
            establecerCarga(boton, false, "Entrar al panel");
        }
    });
}

const btnCerrar = $("bo");
if (btnCerrar) {
    btnCerrar.addEventListener("click", async () => {
        try {
            await signOut(auth);
        } catch (error) {
            alert("No se pudo cerrar la sesión: " + error.message);
        }
    });
}

onAuthStateChanged(auth, usuario => {
    const lg = $("lg");
    const ap = $("ap");
    if (usuario) {
        if (lg) lg.classList.add("hidden");
        if (ap) ap.classList.remove("hidden");
        escucharDispositivos();
        iniciarModuloCursos();
    } else {
        if (lg) lg.classList.remove("hidden");
        if (ap) ap.classList.add("hidden");
        dispositivos = [];
        contactosMap = {};
        versionDetalle++;
        const ls = $("ls");
        if (ls) ls.textContent = "Inicia sesión para consultar los equipos.";
        const dt = $("dt");
        if (dt && !window.location.pathname.includes("detalle.html") && !window.location.pathname.includes("editar.html")) {
            dt.innerHTML = "";
        }
        actualizarEstadisticas();
    }
    if (unsubscribe && !usuario) {
        unsubscribe();
        unsubscribe = null;
    }
});

/* =========================
   REGISTRAR DISPOSITIVO
========================= */
const deviceForm = $("deviceForm");
if (deviceForm) {
    deviceForm.addEventListener("submit", async evento => {
        evento.preventDefault();
        if (operacionEnCurso) return;
        const boton = $("bs");
        const nombre = $("f_cli").value.trim();
        const telefono = $("f_tel").value.trim();
        const telefono2 = $("f_tel2").value.trim();
        const correo = $("f_email").value.trim();
        const direccion = $("f_dir").value.trim();
        const tipo = $("f_tip").value;
        const marca = $("f_mar").value.trim();
        const modelo = $("f_mod").value.trim();
        const color = $("f_col").value.trim();
        const serie = $("f_ser").value.trim();
        const costo = $("f_cos").value.trim();
        const prioridad = $("f_prio") ? $("f_prio").value : "Normal";
        const password = $("f_pass") ? $("f_pass").value.trim() : "";
        const problema = $("f_pro").value.trim();
        const observaciones = $("f_obs") ? $("f_obs").value.trim() : "";
        if (!nombre || !marca || !modelo || !problema || !serie || !observaciones) {
            mostrarMensaje("ok", "Por favor completa todos los campos obligatorios.", "error");
            return;
        }
        if (costo && (!Number.isFinite(Number(costo)) || Number(costo) < 0)) {
            mostrarMensaje("ok", "El costo debe ser igual o mayor que cero.", "error");
            return;
        }
        operacionEnCurso = true;
        establecerCarga(boton, true, "Registrar y generar código");
        const okEl = $("ok");
        if (okEl) okEl.innerHTML = "";
        try {
            let codigo = null;
            for (let i = 0; i < 10; i++) {
                const candidato = generarCodigo();
                const existente = await getDoc(doc(db, "repairs", candidato));
                if (!existente.exists()) {
                    codigo = candidato;
                    break;
                }
            }
            if (!codigo) {
                throw new Error("No se pudo generar un código disponible.");
            }
            const ahora = Date.now();
            const registro = {
                codigo,
                tipo,
                marca,
                modelo,
                color,
                serie,
                problema,
                observaciones,
                costo,
                prioridad,
                password,
                estado: ESTADOS[0],
                creado: ahora,
                actualizado: ahora,
                historial: [{
                    estado: ESTADOS[0],
                    nota: "Equipo recibido",
                    fecha: ahora
                }],
                fotos: []
            };
            const lote = writeBatch(db);
            lote.set(doc(db, "repairs", codigo), registro);
            lote.set(doc(db, "contacts", codigo), {
                cliente: nombre,
                telefono,
                telefono2,
                correo,
                direccion
            });
            await lote.commit();
            if (okEl) {
                okEl.innerHTML = `
                    <div class="message success">
                        <strong>¡Dispositivo registrado correctamente!</strong>
                        <p class="muted">Código de seguimiento:</p>
                        <div class="code">${escapar(codigo)}</div>
                        <button class="btn btn-secondary" id="imprimirNuevo" type="button">
                            Imprimir ticket
                        </button>
                        <button class="btn btn-neutral" id="copiarCodigoNuevo" type="button">
                            Copiar código
                        </button>
                        <button class="btn btn-neutral" id="copiarEnlaceNuevo" type="button">
                            Copiar enlace
                        </button>
                    </div>
                `;
                $("imprimirNuevo")?.addEventListener("click", () => {
                    imprimirTicket(
                        codigo, registro, nombre, telefono,
                        telefono2, correo, direccion
                    );
                });
                $("copiarCodigoNuevo")?.addEventListener("click", () => {
                    copiarTexto(codigo);
                });
                $("copiarEnlaceNuevo")?.addEventListener("click", () => {
                    copiarTexto(enlaceCliente(codigo));
                });
            }
            deviceForm.reset();
        } catch (error) {
            console.error(error);
            mostrarMensaje(
                "ok",
                "No se pudo registrar el equipo. Revisa Firebase. " + error.message,
                "error"
            );
        } finally {
            operacionEnCurso = false;
            establecerCarga(boton, false, "Registrar y generar código");
        }
    });
}

/* =========================
   ESTADÍSTICAS
========================= */
function actualizarEstadisticas() {
    const s1 = $("s1");
    const s2 = $("s2");
    const s3 = $("s3");
    const s4 = $("s4");
    if (s1) s1.textContent = dispositivos.length;
    if (s2) {
        s2.textContent = dispositivos.filter(registro =>
            ["Recibido", "En diagnóstico", "Esperando repuesto", "En reparación"]
                .includes(registro.estado)
        ).length;
    }
    if (s3) {
        s3.textContent = dispositivos.filter(registro =>
            registro.estado === "Listo para entrega"
        ).length;
    }
    if (s4) {
        s4.textContent = dispositivos.filter(registro =>
            registro.estado === "Entregado"
        ).length;
    }
}

/* =========================
   ESCUCHAR FIRESTORE
========================= */
function escucharDispositivos() {
    const ls = $("ls");
    if (!ls && !$("s1")) return;
    if (ls) ls.textContent = "Cargando dispositivos...";
    const consulta = query(
        collection(db, "repairs"),
        orderBy("creado", "desc"),
        limit(200)
    );
    unsubscribe = onSnapshot(consulta, async resultado => {
        dispositivos = resultado.docs.map(documento => ({
            id: documento.id,
            ...documento.data()
        }));
        try {
            const contactosSnap = await getDocs(collection(db, "contacts"));
            contactosMap = {};
            contactosSnap.forEach(docSnap => {
                contactosMap[docSnap.id] = docSnap.data().cliente;
            });
        } catch (e) {
            console.warn("No se pudieron cargar los contactos para la lista", e);
        }
        actualizarEstadisticas();
        renderizarLista();
    }, error => {
        console.error(error);
        mostrarMensaje(
            "ls",
            "No se pudieron cargar los dispositivos. Revisa las reglas de Firestore.",
            "error"
        );
    });
}

/* =========================
   BÚSQUEDA Y FILTROS
========================= */
const inputBusqueda = $("fq");
if (inputBusqueda) {
    inputBusqueda.addEventListener("input", renderizarLista);
}
const selectFiltroEstado = $("fe");
if (selectFiltroEstado) {
    selectFiltroEstado.addEventListener("change", renderizarLista);
}

function renderizarLista() {
    const ls = $("ls");
    if (!ls) return;
    const busqueda = $("fq")
        ? $("fq").value.trim().toLowerCase()
        : "";
    const estado = $("fe") ? $("fe").value : "";
    const filtrados = dispositivos.filter(registro => {
        const coincideEstado = !estado || registro.estado === estado;
        const nombreCliente = contactosMap[registro.id] || "";
        const texto = [
            nombreCliente,
            registro.id,
            registro.tipo,
            registro.marca,
            registro.modelo,
            registro.color,
            registro.serie,
            registro.problema
        ].join(" ").toLowerCase();
        return coincideEstado && texto.includes(busqueda);
    });
    if (!filtrados.length) {
        ls.innerHTML = `
            <div class="message">
                No se encontraron dispositivos con esos criterios.
            </div>
        `;
        return;
    }
    ls.innerHTML = filtrados.map(registro => {
        const nombreCliente = contactosMap[registro.id] || "Sin nombre";
        const detalleEquipo = [registro.marca, registro.modelo, registro.color]
            .filter(Boolean)
            .join(" ") || "Equipo registrado";
        const textoSerie = registro.serie ? `Serie: ${registro.serie}` : "Sin número de serie";
        return `
        <div class="device-row" data-id="${escapar(registro.id)}">
            <div class="device-info">
                <div class="device-header">
                    <div>
                        <strong>${escapar(nombreCliente)}</strong>
                        <small>${escapar(registro.tipo)} · ${escapar(detalleEquipo)}</small>
                        <small style="margin-top: 4px; font-weight: 600; color: #475569;">${escapar(textoSerie)}</small>
                    </div>
                    <div>
                        ${insigniaPrioridad(registro.prioridad)}
                    </div>
                </div>
                <div class="badges-container" style="margin-top: 10px;">
                    ${insignia(registro.estado)}
                </div>
                <div class="device-actions">
                    <button type="button"
                        class="btn-edit edit-device"
                        data-id="${escapar(registro.id)}">
                        ✏️ Editar
                    </button>
                    <button type="button"
                        class="btn-delete delete-device"
                        data-id="${escapar(registro.id)}">
                        🗑 Eliminar
                    </button>
                </div>
                <div style="margin-top: 10px;">
                    <button type="button"
                        class="btn btn-neutral view-device"
                        data-id="${escapar(registro.id)}"
                        style="width: 100%;">
                        Ver detalles
                    </button>
                </div>
            </div>
        </div>
    `;
    }).join("");
}

const contenedorLista = $("ls");
if (contenedorLista) {
    contenedorLista.addEventListener("click", async evento => {
        const btnEliminar = evento.target.closest(".delete-device");
        const btnEditar = evento.target.closest(".edit-device");
        const btnVer = evento.target.closest(".view-device");
        const id = (btnEliminar || btnEditar || btnVer)?.dataset.id;
        if (!id) return;
        if (btnEliminar) {
            evento.preventDefault();
            if (!window.confirm(`¿Seguro que deseas eliminar el dispositivo ${id}?`)) {
                return;
            }
            try {
                await deleteDoc(doc(db, "repairs", id));
                try {
                    await deleteDoc(doc(db, "contacts", id));
                } catch (error) {
                    console.warn("No se pudo eliminar el contacto:", error);
                }
            } catch (error) {
                alert("No se pudo eliminar el dispositivo: " + error.message);
            }
            return;
        }
        if (btnEditar) {
            evento.preventDefault();
            window.location.href = `editar.html?c=${encodeURIComponent(id)}`;
            return;
        }
        if (btnVer) {
            evento.preventDefault();
            window.location.href = `detalle.html?c=${encodeURIComponent(id)}`;
            return;
        }
    });
}

/* =========================
   NOTIFICACIÓN POR WHATSAPP
========================= */
async function enviarNotificacionCliente(codigo, nuevoEstado, nota) {
    try {
        const contSnap = await getDoc(doc(db, "contacts", codigo));
        if (!contSnap.exists()) return;
        const contacto = contSnap.data();
        const telefono = contacto.telefono || contacto.telefono2;
        if (!telefono) {
            alert("No hay un número de teléfono registrado para este cliente.");
            return;
        }
        const numeroLimpio = telefono.replace(/\D/g, "");
        const numeroCompleto = numeroLimpio.startsWith(CONFIG.prefijo)
            ? numeroLimpio
            : `${CONFIG.prefijo}${numeroLimpio}`;
        const mensajeTexto = `Hola ${contacto.cliente}, JS TECH le informa que el estado de su equipo (${codigo}) ha sido actualizado:\n\n Estado: ${nuevoEstado}\n Avance: ${nota}\n\nPuede ver el estado completo aquí:\n${enlaceCliente(codigo)}`;
        const urlWhatsapp = `whatsapp://send?phone=${numeroCompleto}&text=${encodeURIComponent(mensajeTexto)}`;
        window.location.href = urlWhatsapp;
    } catch (error) {
        console.error("Error al generar enlace de WhatsApp:", error);
    }
}

/* =========================
   DETALLES DEL DISPOSITIVO
========================= */
async function abrirDetalle(id, silencioso = false) {
    const miVersion = ++versionDetalle;
    const dt = $("dt");
    if (!dt) return;
    let registro = null;
    try {
        const docSnap = await getDoc(doc(db, "repairs", id));
        if (!docSnap.exists()) {
            dt.innerHTML = `<div class="message error">No se encontró el dispositivo especificado.</div>`;
            return;
        }
        registro = { id: docSnap.id, ...docSnap.data() };
    } catch (error) {
        console.error("Error al cargar dispositivo:", error);
        return;
    }
    let contacto = {
        cliente: "Cliente general",
        telefono: "",
        telefono2: "",
        correo: "",
        direccion: ""
    };
    try {
        const contSnap = await getDoc(doc(db, "contacts", id));
        if (contSnap.exists()) contacto = contSnap.data();
    } catch (error) {
        console.warn("No se pudo cargar el contacto:", error);
    }
    if (miVersion !== versionDetalle) return;
    const historial = Array.isArray(registro.historial)
        ? registro.historial
        : [];
    const tituloDetalle = $("tituloDetalle");
    if (tituloDetalle) {
        tituloDetalle.textContent = `Expediente: ${registro.id}`;
    }
    const detalleMarcaModelo = [registro.marca, registro.modelo]
        .filter(Boolean)
        .join(" ") || "No especificada";
    dt.innerHTML = `
        <article class="card detail-card">
            <div class="detail-heading">
                <div>
                    <span class="section-kicker">EXPEDIENTE TÉCNICO</span>
                    <h2>${escapar(registro.id)}</h2>
                    <p class="muted">${escapar(registro.tipo)} — ${escapar(detalleMarcaModelo)}</p>
                </div>
                <div class="badges-container">
                    ${insignia(registro.estado)}
                    ${insigniaPrioridad(registro.prioridad)}
                </div>
            </div>
            <div class="detail-actions">
                <button class="btn btn-secondary" id="btnImprimirDetalle" type="button">Imprimir ticket</button>
                <button class="btn btn-neutral" id="btnCopiarCodigo" type="button">Copiar código</button>
                <button class="btn btn-neutral" id="btnCopiarEnlace" type="button">Copiar enlace</button>
            </div>
            <div class="detail-meta">
                <div>
                    <p><strong>Cliente:</strong> ${escapar(contacto.cliente)}</p>
                    <p><strong>Teléfono 1:</strong> ${escapar(contacto.telefono || "No registrado")}</p>
                    <p><strong>Teléfono 2:</strong> ${escapar(contacto.telefono2 || "No registrado")}</p>
                    <p><strong>Correo:</strong> ${escapar(contacto.correo || "No registrado")}</p>
                    <p><strong>Dirección:</strong> ${escapar(contacto.direccion || "No registrada")}</p>
                </div>
                <div>
                    <p><strong>Marca / Modelo:</strong> ${escapar(detalleMarcaModelo)}</p>
                    <p><strong>Color:</strong> ${escapar(registro.color || "No especificado")}</p>
                    <p><strong>Serie:</strong> ${escapar(registro.serie || "No especificada")}</p>
                    <p><strong>Contraseña / Patrón:</strong> ${escapar(registro.password || "No especificada")}</p>
                    <p><strong>Costo estimado:</strong> ₡${escapar(registro.costo || "0.00")}</p>
                    <p><strong>Ingreso:</strong> ${formatearFecha(registro.creado)}</p>
                    <p><strong>Última actualización:</strong> ${formatearFecha(registro.actualizado)}</p>
                    <p><strong>Problema reportado:</strong></p>
                    <p class="muted">${escapar(registro.problema)}</p>
                    <p><strong>Observaciones iniciales:</strong></p>
                    <p class="muted">${escapar(registro.observaciones || "Ninguna")}</p>
                </div>
            </div>
            <h3>Historial y progreso</h3>
            <div class="history">
                ${historial.map(h => `
                    <div class="history-item">
                        <strong>${escapar(h.estado)}</strong>
                        ${h.procedimiento ? `<p style="margin:2px 0;"><strong>Procedimiento:</strong> ${escapar(h.procedimiento)}</p>` : ""}
                        ${h.nota ? `<p style="margin:2px 0;">${escapar(h.nota)}</p>` : ""}
                        <small>${formatearFecha(h.fecha)}</small>
                    </div>
                `).join("")}
            </div>
            <section class="card" style="margin-top:24px;">
                <h3>📸 Fotos del dispositivo (Google Drive)</h3>
                <p class="muted">
                    Tomá o selecciona fotografías para subirlas directamente a Google Drive y compartirlas con el cliente.
                </p>
                <button class="btn btn-primary" type="button" id="abrirApartadoFotos">
                    📷 Abrir selector de imágenes
                </button>
                <div id="apartadoFotos" style="display:none;margin-top:20px;">
                    <label for="categoriaFoto">Tipo de fotografía</label>
                    <select id="categoriaFoto">
                        <option value="Estado inicial">Estado inicial</option>
                        <option value="En reparación">En reparación</option>
                        <option value="Trabajo terminado">Trabajo terminado</option>
                        <option value="En diagnostico">En diagnostico</option>
                        <option value="Otra evidencia">Otra evidencia</option>
                    </select>
                    <label for="fotoCamara" style="margin-top:12px;">Tomar fotografía con cámara</label>
                    <input
                        type="file"
                        id="fotoCamara"
                        accept="image/*"
                        capture="environment"
                        multiple
                        class="photo-input"
                    >
                    <label for="fotoGaleria">Seleccionar desde la galería</label>
                    <input
                        type="file"
                        id="fotoGaleria"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        class="photo-input"
                    >
                    <div id="vistaPreviaFotos" class="photo-gallery"></div>
                    <button class="btn btn-primary btn-full" type="button" id="guardarFotos" style="margin-top:16px;">
                        Subir fotografías a Google Drive
                    </button>
                    <p id="mensajeFotos" class="photo-status" aria-live="polite"></p>
                </div>
                <h3 style="margin-top:24px;">Galería en Google Drive</h3>
                <div id="galeriaFotos" class="photo-gallery"></div>
            </section>
            <form class="update-form" id="formActualizarEstado">
                <h4>Actualizar estado del equipo</h4>
                <div class="form-grid">
                    <div class="field">
                        <label for="nuevoEstado">Nuevo estado</label>
                        <select id="nuevoEstado" required>
                            ${ESTADOS.map(e => `
                                <option ${e === registro.estado ? "selected" : ""}>
                                    ${e}
                                </option>
                            `).join("")}
                        </select>
                    </div>
                    <div class="field">
                        <label for="notaEstado">Nota o avance</label>
                        <input id="notaEstado"
                               placeholder="Ej: Se reemplazó la pantalla con éxito..."
                               required>
                    </div>
                </div>
                <div class="field" id="bloqueProcedimiento" style="display: none; margin-top: 12px;">
                    <label for="procedimientoEstado">Procedimiento</label>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                        <select id="procedimientoEstado" style="flex: 1; min-width: 220px;"></select>
                        <button class="btn btn-neutral" type="button" id="btnQuitarProcedimiento">
                            Quitar seleccionado
                        </button>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px;">
                        <input
                            id="nuevoProcedimiento"
                            type="text"
                            placeholder="Nuevo procedimiento..."
                            style="flex: 1; min-width: 220px;"
                        >
                        <button class="btn btn-neutral" type="button" id="btnAgregarProcedimiento">
                            + Agregar
                        </button>
                    </div>
                </div>
                <button class="btn btn-primary" type="submit" style="margin-top:12px;">
                    Guardar cambios
                </button>
            </form>
        </article>
    `;
    $("btnImprimirDetalle")?.addEventListener("click", () => {
        imprimirTicket(
            registro.id,
            registro,
            contacto.cliente,
            contacto.telefono,
            contacto.telefono2,
            contacto.correo,
            contacto.direccion
        );
    });
    $("btnCopiarCodigo")?.addEventListener("click", () => copiarTexto(registro.id));
    $("btnCopiarEnlace")?.addEventListener("click", () => copiarTexto(enlaceCliente(registro.id)));
    configurarFotosGoogleDrive(registro.id, registro.fotos || []);
    const selectNuevoEstado = $("nuevoEstado");
    const bloqueProcedimiento = $("bloqueProcedimiento");
    const selectProcedimiento = $("procedimientoEstado");
    const inputNuevoProcedimiento = $("nuevoProcedimiento");
    const btnAgregarProcedimiento = $("btnAgregarProcedimiento");
    const btnQuitarProcedimiento = $("btnQuitarProcedimiento");
    function renderizarOpcionesProcedimiento(seleccionDeseada = "") {
        if (!selectProcedimiento) return;
        const personalizados = obtenerProcedimientosPersonalizados();
        const valorActual = seleccionDeseada || selectProcedimiento.value;
        const placeholder = personalizados.length
            ? "Selecciona un procedimiento..."
            : "Agrega un procedimiento con + Agregar...";
        selectProcedimiento.innerHTML = `
            <option value="">${escapar(placeholder)}</option>
            ${personalizados.map(p => `
                <option value="${escapar(p)}" ${valorActual === p ? "selected" : ""}>
                    ${escapar(p)}
                </option>
            `).join("")}
        `;
    }
    renderizarOpcionesProcedimiento(registro.procedimiento || "");
    btnAgregarProcedimiento?.addEventListener("click", () => {
        const nuevo = (inputNuevoProcedimiento?.value || "").trim();
        if (!nuevo) {
            alert("Escribe un procedimiento antes de agregarlo.");
            inputNuevoProcedimiento?.focus();
            return;
        }
        const lista = obtenerProcedimientosPersonalizados();
        const existente = lista.find(item => item.toLowerCase() === nuevo.toLowerCase());
        if (!existente) {
            lista.push(nuevo);
            guardarProcedimientosPersonalizados(lista);
        }
        renderizarOpcionesProcedimiento(existente || nuevo);
        if (inputNuevoProcedimiento) {
            inputNuevoProcedimiento.value = "";
            inputNuevoProcedimiento.focus();
        }
    });
    btnQuitarProcedimiento?.addEventListener("click", () => {
        const seleccionado = (selectProcedimiento?.value || "").trim();
        if (!seleccionado) {
            alert("Selecciona un procedimiento de la lista para quitarlo.");
            return;
        }
        if (!confirm(`¿Quitar "${seleccionado}" de tus procedimientos?`)) {
            return;
        }
        const lista = obtenerProcedimientosPersonalizados().filter(
            item => item.toLowerCase() !== seleccionado.toLowerCase()
        );
        guardarProcedimientosPersonalizados(lista);
        renderizarOpcionesProcedimiento("");
    });
    function actualizarVisibilidadProcedimiento() {
        if (!selectNuevoEstado || !bloqueProcedimiento) return;
        const esReparacion = selectNuevoEstado.value === "En reparación";
        bloqueProcedimiento.style.display = esReparacion ? "block" : "none";
        if (!esReparacion && selectProcedimiento) {
            selectProcedimiento.value = "";
        }
    }
    selectNuevoEstado?.addEventListener("change", actualizarVisibilidadProcedimiento);
    actualizarVisibilidadProcedimiento();
    $("formActualizarEstado")?.addEventListener("submit", async ev => {
        ev.preventDefault();
        const nuevoEstado = $("nuevoEstado").value;
        const nota = $("notaEstado").value.trim();
        const procedimiento = nuevoEstado === "En reparación" && selectProcedimiento
            ? selectProcedimiento.value.trim()
            : "";
        if (nuevoEstado === "En reparación" && !procedimiento) {
            alert("Selecciona o agrega un procedimiento para el estado En reparación.");
            selectProcedimiento?.focus();
            return;
        }
        try {
            const ahora = Date.now();
            const entradaHistorial = { estado: nuevoEstado, nota, fecha: ahora };
            if (procedimiento) {
                entradaHistorial.procedimiento = procedimiento;
            }
            const nuevoHistorial = [
                ...(registro.historial || []),
                entradaHistorial
            ];
            await updateDoc(doc(db, "repairs", id), {
                estado: nuevoEstado,
                procedimiento,
                actualizado: ahora,
                historial: nuevoHistorial
            });
            const detalleNota = procedimiento ? `${nota} (Procedimiento: ${procedimiento})` : nota;
            await enviarNotificacionCliente(id, nuevoEstado, detalleNota);
            alert("Estado actualizado correctamente.");
            abrirDetalle(id, true);
        } catch (error) {
            alert("No se pudo actualizar: " + error.message);
        }
    });
}

/* =========================
   FOTOGRAFÍAS CON GOOGLE DRIVE
========================= */
function configurarFotosGoogleDrive(codigo, fotosIniciales = []) {
    const abrir = $("abrirApartadoFotos");
    const apartado = $("apartadoFotos");
    const camara = $("fotoCamara");
    const galeria = $("fotoGaleria");
    const vista = $("vistaPreviaFotos");
    const guardar = $("guardarFotos");
    const mensaje = $("mensajeFotos");
    const galeriaGuardada = $("galeriaFotos");
    if (!abrir || !apartado || !camara || !galeria ||
        !vista || !guardar || !mensaje || !galeriaGuardada) {
        return;
    }
    let seleccionadas = [];
    let urlsTemporales = [];
    function limpiarPrevisualizaciones() {
        urlsTemporales.forEach(url => URL.revokeObjectURL(url));
        urlsTemporales = [];
        vista.innerHTML = "";
    }
    function dibujarPrevisualizaciones() {
        limpiarPrevisualizaciones();
        seleccionadas.forEach((archivo, indice) => {
            const url = URL.createObjectURL(archivo);
            urlsTemporales.push(url);
            const tarjeta = document.createElement("div");
            tarjeta.className = "photo-item";
            const imagen = document.createElement("img");
            imagen.src = url;
            imagen.alt = "Vista previa";
            const nombre = document.createElement("p");
            nombre.textContent = archivo.name;
            const quitar = document.createElement("button");
            quitar.type = "button";
            quitar.className = "btn btn-neutral";
            quitar.textContent = "Quitar";
            quitar.style.cssText = "margin-top:6px;width:100%;padding:6px;";
            quitar.addEventListener("click", () => {
                seleccionadas.splice(indice, 1);
                dibujarPrevisualizaciones();
                mensaje.textContent = `Imágenes seleccionadas: ${seleccionadas.length}`;
            });
            tarjeta.append(imagen, nombre, quitar);
            vista.appendChild(tarjeta);
        });
    }
    function agregarArchivos(archivos) {
        const permitidos = ["image/jpeg", "image/png", "image/webp"];
        let rechazados = 0;
        for (const archivo of archivos) {
            if (!permitidos.includes(archivo.type) || archivo.size > 10 * 1024 * 1024) {
                rechazados++;
                continue;
            }
            seleccionadas.push(archivo);
        }
        dibujarPrevisualizaciones();
        mensaje.textContent = rechazados
            ? `Se omitieron ${rechazados} archivo(s). Usa JPG, PNG o WEBP de máximo 10MB.`
            : `Imágenes seleccionadas: ${seleccionadas.length}`;
    }
    function dibujarGaleria(fotos) {
        const lista = Array.isArray(fotos) ? fotos : [];
        if (!lista.length) {
            galeriaGuardada.innerHTML = '<p class="muted">Todavía no hay fotografías en Google Drive para este equipo.</p>';
            return;
        }
        galeriaGuardada.innerHTML = lista.map((foto, indice) => {
            if (!foto || typeof foto.url !== "string") return "";
            const fechaFotoStr = formatearFecha(foto.fecha);
            return `
                <div class="photo-item">
                    <a href="${escapar(foto.url)}" target="_blank" rel="noopener noreferrer">
                        <img src="${escapar(foto.url)}" alt="${escapar(foto.categoria || "Foto")}" loading="lazy">
                    </a>
                    <p><strong>${escapar(foto.categoria || "Evidencia")}</strong></p>
                    <small class="muted" style="display:block;margin-top:2px;">📅 ${escapar(fechaFotoStr)}</small>
                    <button
                        type="button"
                        class="btn btn-neutral"
                        data-eliminar-foto="${indice}"
                        style="margin-top:8px;background:#fee2e2;color:#b91c1c;border:0;width:100%;font-size:11px;"
                    >
                        🗑 Eliminar de la lista
                    </button>
                </div>
            `;
        }).join("");
    }
    abrir.addEventListener("click", () => {
        const cerrado = apartado.style.display === "none";
        apartado.style.display = cerrado ? "block" : "none";
        abrir.textContent = cerrado ? "✖ Cerrar selector" : "📷 Abrir selector de imágenes";
    });
    camara.addEventListener("change", () => {
        agregarArchivos(Array.from(camara.files || []));
        camara.value = "";
    });
    galeria.addEventListener("change", () => {
        agregarArchivos(Array.from(galeria.files || []));
        galeria.value = "";
    });
    dibujarGaleria(fotosIniciales);
    guardar.addEventListener("click", async () => {
        if (!seleccionadas.length) {
            mensaje.textContent = "Primero selecciona al menos una fotografía.";
            return;
        }
        const categoria = $("categoriaFoto").value;
        const archivos = [...seleccionadas];
        guardar.disabled = true;
        guardar.textContent = "Subiendo a Google Drive...";
        mensaje.textContent = "Subiendo imágenes a tu Drive. Por favor espera...";
        const fotosSubidas = [];
        try {
            for (let i = 0; i < archivos.length; i++) {
                const archivo = archivos[i];
                mensaje.textContent = `Subiendo foto ${i + 1} de ${archivos.length} a Google Drive...`;
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = error => reject(error);
                    reader.readAsDataURL(archivo);
                });
                const respuesta = await fetch(URL_GOOGLE_DRIVE, {
                    method: "POST",
                    body: JSON.stringify({
                        file: base64,
                        filename: `${codigo}_${Date.now()}_${archivo.name}`
                    })
                });
                const resultado = await respuesta.json();
                if (resultado.status === "success") {
                    fotosSubidas.push({
                        url: resultado.url,
                        nombre: archivo.name,
                        categoria,
                        fecha: Date.now()
                    });
                } else {
                    throw new Error(resultado.message || "Error al subir a Google Drive");
                }
            }
            await updateDoc(doc(db, "repairs", codigo), {
                fotos: arrayUnion(...fotosSubidas),
                actualizado: Date.now()
            });
            seleccionadas = [];
            limpiarPrevisualizaciones();
            mensaje.textContent = "¡Fotos subidas con éxito a Google Drive y guardadas!";
            const actualizado = await getDoc(doc(db, "repairs", codigo));
            if (actualizado.exists()) {
                dibujarGaleria(actualizado.data().fotos || []);
            }
        } catch (error) {
            console.error("Error al subir a Google Drive:", error);
            mensaje.textContent = "No se pudieron subir las fotos: " + error.message;
        } finally {
            guardar.disabled = false;
            guardar.textContent = "Subir fotografías a Google Drive";
        }
    });
    galeriaGuardada.addEventListener("click", async evento => {
        const boton = evento.target.closest("[data-eliminar-foto]");
        if (!boton) return;
        const indice = Number(boton.dataset.eliminarFoto);
        if (!Number.isInteger(indice) || indice < 0) return;
        if (!confirm("¿Deseas quitar esta fotografía del expediente?")) return;
        try {
            const resultado = await getDoc(doc(db, "repairs", codigo));
            if (!resultado.exists()) return;
            const fotos = resultado.data().fotos || [];
            const fotosRestantes = fotos.filter((_, i) => i !== indice);
            await updateDoc(doc(db, "repairs", codigo), {
                fotos: fotosRestantes,
                actualizado: Date.now()
            });
            dibujarGaleria(fotosRestantes);
        } catch (error) {
            alert("No se pudo actualizar la lista: " + error.message);
        }
    });
}

/* =========================
   EDITAR DISPOSITIVO Y CONTACTO (EN EDITAR.HTML)
========================= */
async function abrirEdicion(id) {
    const dt = $("dt");
    if (!dt) return;
    dt.innerHTML = `<div class="message">Cargando datos del equipo...</div>`;
    let registro = null;
    try {
        const docSnap = await getDoc(doc(db, "repairs", id));
        if (!docSnap.exists()) {
            dt.innerHTML = `<div class="message error">No se encontró el dispositivo especificado.</div>`;
            return;
        }
        registro = { id: docSnap.id, ...docSnap.data() };
    } catch (error) {
        dt.innerHTML = `<div class="message error">Error al cargar el dispositivo: ${escapar(error.message)}</div>`;
        return;
    }
    let contacto = {
        cliente: "",
        telefono: "",
        telefono2: "",
        correo: "",
        direccion: ""
    };
    try {
        const contSnap = await getDoc(doc(db, "contacts", id));
        if (contSnap.exists()) {
            contacto = contSnap.data();
        }
    } catch (error) {
        console.warn("No se pudo cargar el contacto para editar:", error);
    }
    const tituloEditar = $("tituloEditar");
    if (tituloEditar) {
        tituloEditar.textContent = `Editando: ${registro.id}`;
    }
    dt.innerHTML = `
        <article class="card edit-card">
            <div class="section-heading">
                <div>
                    <span class="section-kicker">MODIFICAR DATOS</span>
                    <h2>Editar dispositivo</h2>
                    <p class="muted" style="margin-top:4px;">
                        <strong>${escapar(registro.marca || "")} ${escapar(registro.modelo || "")}</strong><br>
                        Serie: ${escapar(registro.serie || "Sin número de serie")}
                    </p>
                </div>
            </div>
            <form id="formEdicao">
                <div class="form-grid">
                    <div class="field">
                        <label for="e_cli">Nombre del cliente *</label>
                        <input id="e_cli" value="${escapar(contacto.cliente || "")}" required>
                    </div>
                    <div class="field">
                        <label for="e_mar">Marca *</label>
                        <input id="e_mar" value="${escapar(registro.marca || "")}" required>
                    </div>
                    <div class="field">
                        <label for="e_mod">Modelo*</label>
                        <input id="e_mod" value="${escapar(registro.modelo || "")}" required>
                    </div>
                    <div class="field">
                        <label for="e_col">Color</label>
                        <input id="e_col" value="${escapar(registro.color || "")}">
                    </div>
                    <div class="field">
                        <label for="e_ser">Serie*</label>
                        <input id="e_ser" value="${escapar(registro.serie || "")}" required>
                    </div>
                    <div class="field">
                        <label for="e_tel">Teléfono 1</label>
                        <input id="e_tel" type="tel" value="${escapar(contacto.telefono || "")}" maxlength="25">
                    </div>
                    <div class="field">
                        <label for="e_cos">Costo estimado (₡)</label>
                        <input id="e_cos" type="number" min="0" step="0.01"
                               value="${escapar(registro.costo || "")}">
                    </div>
                    <div class="field">
                        <label for="e_prio">Prioridad *</label>
                        <select id="e_prio" required>
                            <option value="Normal" ${registro.prioridad === "Normal" ? "selected" : ""}>Normal</option>
                            <option value="Urgente" ${registro.prioridad === "Urgente" ? "selected" : ""}>Urgente</option>
                        </select>
                    </div>
                    <div class="field">
                        <label for="e_pass">Contraseña / Patrón</label>
                        <input id="e_pass" value="${escapar(registro.password || "")}" maxlength="100">
                    </div>
                </div>
                <div class="field" style="margin-top:12px;">
                    <label for="e_pro">Problema reportado *</label>
                    <textarea id="e_pro" rows="3" required>${escapar(registro.problema)}</textarea>
                </div>
                <div class="field" style="margin-top:12px;">
                    <label for="e_obs">Observaciones iniciales *</label>
                    <textarea id="e_obs" rows="3" required>${escapar(registro.observaciones || "")}</textarea>
                </div>
                <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
                    <button class="btn btn-primary" type="submit" id="btnGuardarEdicion">Guardar cambios</button>
                    <button class="btn btn-neutral" type="button" id="cancelarEdicion">Cancelar</button>
                </div>
            </form>
        </article>
    `;
    $("cancelarEdicion").addEventListener("click", () => {
        window.location.href = "dispositivos.html";
    });
    $("formEdicao").addEventListener("submit", async ev => {
        ev.preventDefault();
        const marcaEditada = $("e_mar").value.trim();
        const modeloEditado = $("e_mod").value.trim();
        const serieEditada = $("e_ser").value.trim();
        const obsEditadas = $("e_obs").value.trim();
        if (!marcaEditada || !modeloEditado || !serieEditada || !obsEditadas) {
            alert("Los campos Marca, Modelo, Serie y Observaciones iniciales son obligatorios.");
            return;
        }
        const btnGuardar = $("btnGuardarEdicion");
        establecerCarga(btnGuardar, true, "Guardar cambios");
        try {
            const ahora = Date.now();
            await updateDoc(doc(db, "repairs", id), {
                marca: marcaEditada,
                modelo: modeloEditado,
                color: $("e_col").value.trim(),
                serie: serieEditada,
                costo: $("e_cos").value.trim(),
                prioridad: $("e_prio").value,
                password: $("e_pass").value.trim(),
                problema: $("e_pro").value.trim(),
                observaciones: obsEditadas,
                actualizado: ahora
            });
            const nuevoCliente = $("e_cli").value.trim();
            const nuevoTelefono = $("e_tel").value.trim();
            await updateDoc(doc(db, "contacts", id), {
                cliente: nuevoCliente,
                telefono: nuevoTelefono
            });
            alert("Dispositivo y contacto actualizados con éxito.");
            window.location.href = "dispositivos.html";
        } catch (error) {
            alert("Error al actualizar: " + error.message);
            establecerCarga(btnGuardar, false, "Guardar cambios");
        }
    });
}

/* =========================
   IMPRIMIR TICKET
========================= */
function imprimirTicket(codigo, registro, cliente, telefono, telefono2, correo, direccion) {
    const ventanaImpresion = window.open("", "_blank");
    if (!ventanaImpresion) {
        alert("Por favor, permite las ventanas emergentes para imprimir el ticket.");
        return;
    }
    const fechaIngreso = formatearFecha(registro.creado);
    ventanaImpresion.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Comprobante - ${escapar(codigo)}</title>
            <style>
                @page {
                    size: portrait;
                    margin: 6mm;
                }
                body {
                    font-family: Arial, sans-serif;
                    font-size: 12px;
                    color: #000;
                    margin: 0;
                    padding: 0;
                }
                .ticket-container {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .bloque-seccion {
                    width: 100%;
                    box-sizing: border-box;
                    padding: 14px;
                    border: 2px solid #2b5797;
                    border-radius: 8px;
                    page-break-inside: avoid;
                }
                .bloque-codigo {
                    width: 100%;
                    text-align: center;
                    background: #eef4ff;
                    border: 2px solid #2b5797;
                    border-radius: 8px;
                    padding: 10px;
                    page-break-inside: avoid;
                }
                .codigo-destacado {
                    font-size: 32px;
                    font-weight: 800;
                    letter-spacing: 4px;
                    color: #2b5797;
                    margin: 4px 0;
                }
                .header-ticket {
                    text-align: center;
                    margin-bottom: 10px;
                }
                .header-ticket h2 {
                    margin: 0;
                    font-size: 18px;
                    color: #2b5797;
                }
                .header-ticket p {
                    margin: 2px 0;
                    font-size: 10px;
                    color: #555;
                }
                h3 {
                    text-align: center;
                    font-size: 12px;
                    margin: 8px 0;
                    color: #2b5797;
                    text-decoration: underline;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 8px;
                }
                th, td {
                    border: 1px solid #2b5797;
                    padding: 6px 8px;
                    font-size: 11px;
                    text-align: left;
                }
                th {
                    background-color: #2b5797;
                    color: white;
                    text-align: center;
                    font-size: 11.5px;
                }
                .seccion-tabla {
                    height: 60px;
                    vertical-align: top;
                }
                .politicas ol {
                    padding-left: 18px;
                    margin: 4px 0;
                }
                .politicas li {
                    font-size: 9px;
                    margin-bottom: 3px;
                    text-align: justify;
                }
                .firmas {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 25px;
                    font-size: 11px;
                }
                .firma-linea {
                    width: 45%;
                    border-top: 1px solid #2b5797;
                    text-align: center;
                    padding-top: 4px;
                    color: #2b5797;
                    font-weight: bold;
                }
                .footer-ticket {
                    margin-top: 6px;
                    font-size: 9px;
                    text-align: center;
                    border-top: 1px solid #2b5797;
                    padding-top: 4px;
                    color: #555;
                }
                @media print {
                    body {
                        padding: 0;
                    }
                }
            </style>
        </head>
        <body onload="window.print(); window.close();">
            <div class="ticket-container">
                <div class="bloque-seccion">
                    <div class="header-ticket">
                        <h2>JS TECH</h2>
                        <p>Frente al Hotel Cañas. Cañas, Guanacaste | Teléfono +506 8638 9553 | Cédula física # 5 0395 0104</p>
                    </div>
                    <table>
                        <tr>
                            <th colspan="2">DATOS GENERALES</th>
                        </tr>
                        <tr>
                            <td><strong>Nombre:</strong> ${escapar(cliente)}</td>
                            <td><strong>Fecha de ingreso:</strong> ${escapar(fechaIngreso)}</td>
                        </tr>
                        <tr>
                            <td><strong>Teléfono 1:</strong> ${escapar(telefono || "No registrado")}</td>
                            <td><strong>Teléfono 2:</strong> ${escapar(telefono2 || "No registrado")}</td>
                        </tr>
                        <tr>
                            <td colspan="2"><strong>Correo electrónico:</strong> ${escapar(correo || "No registrado")}</td>
                        </tr>
                        <tr>
                            <td colspan="2"><strong>Dirección:</strong> ${escapar(direccion || "No registrada")}</td>
                        </tr>
                    </table>
                    <table>
                        <tr>
                            <th colspan="4">DATOS DEL EQUIPO</th>
                        </tr>
                        <tr>
                            <td><strong>Marca:</strong> ${escapar(registro.marca || "N/A")}</td>
                            <td><strong>Modelo:</strong> ${escapar(registro.modelo || "N/A")}</td>
                            <td><strong>Tipo:</strong> ${escapar(registro.tipo)}</td>
                            <td><strong>Color:</strong> ${escapar(registro.color || "N/A")}</td>
                        </tr>
                        <tr>
                            <td colspan="2"><strong>Serie:</strong> ${escapar(registro.serie || "N/A")}</td>
                            <td colspan="2"><strong>Costo Estimado:</strong> ₡${escapar(registro.costo || "0.00")}</td>
                        </tr>
                        <tr>
                            <td colspan="4" class="seccion-tabla"><strong>Problema reportado / Comentario Usuario:</strong><br>${escapar(registro.problema)}</td>
                        </tr>
                        <tr>
                            <td colspan="4" class="seccion-tabla"><strong>Observaciones iniciales:</strong><br>${escapar(registro.observaciones || "Ninguna")}</td>
                        </tr>
                    </table>
                    <div class="footer-ticket">
                        <p>ventasjystechnology@gmail.com</p>
                    </div>
                </div>
                <div class="bloque-codigo">
                    <span style="font-size: 11px; font-weight: bold; color: #2b5797; text-transform: uppercase;">Código de Seguimiento</span>
                    <div class="codigo-destacado">${escapar(codigo)}</div>
                </div>
                <div class="bloque-seccion">
                    <div class="header-ticket">
                        <h2>JS TECH</h2>
                        <p>Frente al Hotel Cañas. Cañas, Guanacaste | Teléfono +506 8638 9553 | Cédula física # 5 0395 0104</p>
                    </div>
                    <h3>Políticas de JS TECH:</h3>
                    <div class="politicas">
                        <ol>
                            <li>Cada equipo se evaluará primero antes de proceder a realizar alguna instalación, reparación, mantenimiento u otros. Una vez se determine las acciones a realizar, se contactará al cliente para analizar costos y otros.</li>
                            <li>Una vez ingresado el equipo a taller y entregado este documento, el cliente aprueba que se realice mantenimiento o reparación durante la revisión, si fuese necesario, para determinar el funcionamiento del mismo, aunque no se haya contactado al propietario primero. Se entiende que cada trabajo, sea mantenimiento o reparación durante o posterior a la revisión, reflejará los costos en los misceláneos de la factura final.</li>
                            <li>La revisión de computadoras, tanto laptops como de escritorio, es gratuita, siempre y cuando no se realice ninguna reparación, mantenimiento, diagnóstico por escrito y/o comprobación de partes durante o posterior a la misma.</li>
                            <li>Toda revisión en impresoras tendrá un valor inicial de ₡5.000, monto que será rebajado en el valor final de la reparación.</li>
                            <li>Una vez que el equipo ingrese al establecimiento se acordará entre ambas partes los plazos correspondientes a revisión, eventual reparación, mantenimiento o instalación, fecha y hora de entrega.</li>
                            <li>JS TECH no se hace responsable por daños (previos al ingreso) provocados por terceros, o daños que surjan en el tiempo de estadía del equipo en la tienda causados por mala manipulación del usuario o terceros, ni por tiempo excedido adecuado para intervenir el equipo.</li>
                            <li>Una vez acordado el tiempo de entrega o se notifique que el equipo se encuentra listo para ser retirado, el propietario contará con seis meses para hacer efectivo el retiro. Caso contrario, el equipo pasará a manos de JS TECH para ser procesado según estado final del equipo; ya sea, dado de baja o asignado a disposición del taller para cubrir gastos de bodegaje, misceláneos o trabajos realizados. En caso de ser necesario, se extenderá un plazo adicional, el cual, se establecerá a criterio de la administración y propietario.</li>
                            <li>Al ingresar el equipo a taller, el cliente está de acuerdo en que se utilice material promocional generado durante la intervención del equipo para redes sociales, afiches y otro (contenido tal como imágenes, videos, audios, entre otros) con el objetivo de promocionar el trabajo realizado por nuestra empresa sin que se revele o filtre información sensible y personal del usuario.</li>
                            <li>Nos reservamos el derecho de admisión.</li>
                        </ol>
                    </div>
                    <div class="firmas">
                        <div class="firma-linea">
                            Recibe: Jorge Villalobos Barrera
                        </div>
                        <div class="firma-linea">
                            Entrega:
                        </div>
                    </div>
                    <div class="footer-ticket" style="margin-top: 10px;">
                        <p>ventasjystechnology@gmail.com</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);
    ventanaImpresion.document.close();
}

/* =========================
   APARTADO DE CURSOS Y GUÍAS (AISLADO PARA CURSOS.HTML)
========================= */
let cursosInicializado = false;
function iniciarModuloCursos() {
    const contenedorModulos = $("contenedorModulosCurso");
    if (!contenedorModulos || cursosInicializado) return;
    cursosInicializado = true;

    const btnToggleCreador = $("btnToggleCreadorCurso");
    const panelCreador = $("panelCreadorCurso");
    const formModulo = $("formCrearModulo");
    const formSubtitulo = $("formCrearSubtitulo");
    const selectModulos = $("c_sub_modulo");

    const inputFotosNuevo = $("c_sub_fotos");
    const previewFotosNuevo = $("c_sub_preview");
    const estadoFotosNuevo = $("c_sub_estado_fotos");
    const btnGuardarSubtitulo = $("btnGuardarSubtitulo");

    const panelEditor = $("panelEditorCurso");
    const tituloEditor = $("tituloEditorCurso");
    const btnCerrarEditor = $("btnCerrarEditorCurso");
    const formEditarModulo = $("formEditarModulo");
    const formEditarSubtitulo = $("formEditarSubtitulo");
    const btnCancelarEdicionSub = $("btnCancelarEdicionSub");
    const btnGuardarEdicionSub = $("btnGuardarEdicionSub");

    const editSubFotosActuales = $("edit_sub_fotos_actuales");
    const editSubNuevasFotos = $("edit_sub_nuevas_fotos");
    const editSubPreview = $("edit_sub_preview");
    const editSubEstadoFotos = $("edit_sub_estado_fotos");

    const lightbox = $("cursoLightbox");
    const lightboxImg = $("cursoLightboxImg");
    const lightboxDesc = $("cursoLightboxDesc");
    const lightboxCerrar = $("cursoLightboxCerrar");

    let listaModulos = [];
    let archivosNuevoSub = [];
    let archivosEditSub = [];
    let fotosEditActuales = [];
    let modulosAbiertos = new Set();
    let temasAbiertos = new Set();

    function abrirLightbox(src, desc = "", alt = "Foto ampliada") {
        if (!lightbox || !lightboxImg || !src) return;
        lightboxImg.src = src;
        lightboxImg.alt = alt || "Foto ampliada";
        if (lightboxDesc) {
            const textoDesc = String(desc ?? "").trim();
            lightboxDesc.textContent = textoDesc;
            lightboxDesc.classList.toggle("hidden", !textoDesc);
        }
        lightbox.classList.remove("hidden");
    }

    function cerrarLightbox() {
        if (!lightbox || !lightboxImg) return;
        lightbox.classList.add("hidden");
        lightboxImg.src = "";
        if (lightboxDesc) {
            lightboxDesc.textContent = "";
        }
    }

    lightboxCerrar?.addEventListener("click", cerrarLightbox);
    lightbox?.addEventListener("click", e => {
        if (e.target === lightbox) {
            cerrarLightbox();
        }
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && lightbox && !lightbox.classList.contains("hidden")) {
            cerrarLightbox();
        }
    });

    function formatearTextoEnProsa(texto) {
        const limpio = String(texto ?? "").replace(/\r\n/g, "\n").trim();
        if (!limpio) return "";
        const parrafos = limpio
            .split(/\n\s*\n/)
            .map(bloque => bloque.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim())
            .filter(Boolean);
        return parrafos.map(p => `<p class="curso-parrafo">${escapar(p)}</p>`).join("");
    }

    async function subirArchivosCursoAGoogleDrive(items, prefijo = "CURSO", estadoEl = null) {
        const permitidos = ["image/jpeg", "image/png", "image/webp"];
        const subidas = [];
        for (let i = 0; i < items.length; i++) {
            const entry = items[i];
            const archivo = entry.file;
            const descripcion = String(entry.descripcion ?? "").trim();
            if (!permitidos.includes(archivo.type) || archivo.size > 10 * 1024 * 1024) {
                throw new Error(`"${archivo.name}" no es válido (usa JPG, PNG o WEBP de máx. 10MB).`);
            }
            if (estadoEl) {
                estadoEl.textContent = `Subiendo foto ${i + 1} de ${items.length} a Google Drive...`;
            }
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = err => reject(err);
                reader.readAsDataURL(archivo);
            });
            const respuesta = await fetch(URL_GOOGLE_DRIVE, {
                method: "POST",
                body: JSON.stringify({
                    file: base64,
                    filename: `${prefijo}_${Date.now()}_${archivo.name}`
                })
            });
            const resultado = await respuesta.json();
            if (resultado.status === "success" && resultado.url) {
                subidas.push({
                    url: resultado.url,
                    nombre: archivo.name,
                    descripcion
                });
            } else {
                throw new Error(resultado.message || "Error al subir imagen a Google Drive.");
            }
        }
        return subidas;
    }

    function renderPreviewArchivos(items, contenedor, onQuitar) {
        if (!contenedor) return;
        contenedor.innerHTML = "";
        items.forEach((entry, idx) => {
            const url = URL.createObjectURL(entry.file);
            const item = document.createElement("div");
            item.className = "curso-preview-item";
            item.innerHTML = `
                <img src="${escapar(url)}" alt="${escapar(entry.file.name)}" class="curso-foto-ampliable" data-desc="${escapar(entry.descripcion || "")}">
                <span>${escapar(entry.file.name)}</span>
                <input type="text" class="curso-foto-desc-input" placeholder="Descripción de la foto (opcional)..." value="${escapar(entry.descripcion || "")}">
                <button type="button" class="curso-btn-mini-del">Quitar</button>
            `;
            const imgEl = item.querySelector("img");
            const inputEl = item.querySelector("input");
            imgEl.addEventListener("click", () => {
                abrirLightbox(url, entry.descripcion || "", entry.file.name);
            });
            inputEl.addEventListener("input", ev => {
                entry.descripcion = ev.target.value;
                imgEl.dataset.desc = ev.target.value;
            });
            item.querySelector("button").addEventListener("click", () => {
                URL.revokeObjectURL(url);
                onQuitar(idx);
            });
            contenedor.appendChild(item);
        });
    }

    if (inputFotosNuevo) {
        inputFotosNuevo.addEventListener("change", function onChangeNuevo() {
            const agregados = Array.from(inputFotosNuevo.files || []).map(file => ({
                file,
                descripcion: ""
            }));
            archivosNuevoSub = [...archivosNuevoSub, ...agregados];
            inputFotosNuevo.value = "";
            const quitarHandler = idx => {
                archivosNuevoSub.splice(idx, 1);
                renderPreviewArchivos(archivosNuevoSub, previewFotosNuevo, quitarHandler);
                if (estadoFotosNuevo) {
                    estadoFotosNuevo.textContent = archivosNuevoSub.length
                        ? `${archivosNuevoSub.length} foto(s) lista(s) para subir.`
                        : "";
                }
            };
            renderPreviewArchivos(archivosNuevoSub, previewFotosNuevo, quitarHandler);
            if (estadoFotosNuevo) {
                estadoFotosNuevo.textContent = archivosNuevoSub.length
                    ? `${archivosNuevoSub.length} foto(s) lista(s) para subir.`
                    : "";
            }
        });
    }

    function renderFotosEditActuales() {
        if (!editSubFotosActuales) return;
        if (!fotosEditActuales.length) {
            editSubFotosActuales.innerHTML = `<p class="muted">Este tema no tiene fotografías guardadas.</p>`;
            return;
        }
        editSubFotosActuales.innerHTML = fotosEditActuales.map((foto, i) => `
            <div class="curso-foto-card">
                <img src="${escapar(foto.url)}" alt="${escapar(foto.nombre || "Foto del tema")}" loading="lazy" class="curso-foto-ampliable" data-desc="${escapar(foto.descripcion || "")}">
                <input type="text" class="curso-foto-desc-input btn-desc-foto-edit" data-fidx="${i}" placeholder="Descripción de la foto..." value="${escapar(foto.descripcion || "")}">
                <button type="button" class="curso-btn-mini-del btn-quitar-foto-edit" data-fidx="${i}" style="margin-top:4px;width:100%;">
                    🗑 Quitar foto
                </button>
            </div>
        `).join("");
    }

    if (editSubFotosActuales) {
        editSubFotosActuales.addEventListener("input", e => {
            const inputDesc = e.target.closest(".btn-desc-foto-edit");
            if (!inputDesc) return;
            const fidx = Number(inputDesc.dataset.fidx);
            if (fotosEditActuales[fidx]) {
                fotosEditActuales[fidx].descripcion = inputDesc.value;
                const card = inputDesc.closest(".curso-foto-card");
                const img = card?.querySelector("img");
                if (img) img.dataset.desc = inputDesc.value;
            }
        });

        editSubFotosActuales.addEventListener("click", e => {
            const btn = e.target.closest(".btn-quitar-foto-edit");
            if (btn) {
                const fidx = Number(btn.dataset.fidx);
                fotosEditActuales = fotosEditActuales.filter((_, i) => i !== fidx);
                renderFotosEditActuales();
                return;
            }
            const img = e.target.closest("img.curso-foto-ampliable");
            if (img) {
                abrirLightbox(img.src, img.dataset.desc || "", img.alt);
            }
        });
    }

    if (editSubNuevasFotos) {
        editSubNuevasFotos.addEventListener("change", () => {
            const agregados = Array.from(editSubNuevasFotos.files || []).map(file => ({
                file,
                descripcion: ""
            }));
            archivosEditSub = [...archivosEditSub, ...agregados];
            editSubNuevasFotos.value = "";
            const quitarEditHandler = idx => {
                archivosEditSub.splice(idx, 1);
                renderPreviewArchivos(archivosEditSub, editSubPreview, quitarEditHandler);
                if (editSubEstadoFotos) {
                    editSubEstadoFotos.textContent = archivosEditSub.length
                        ? `${archivosEditSub.length} foto(s) nueva(s) por subir.`
                        : "";
                }
            };
            renderPreviewArchivos(archivosEditSub, editSubPreview, quitarEditHandler);
            if (editSubEstadoFotos) {
                editSubEstadoFotos.textContent = archivosEditSub.length
                    ? `${archivosEditSub.length} foto(s) nueva(s) por subir.`
                    : "";
            }
        });
    }

    function cerrarEditorCurso() {
        if (!panelEditor) return;
        panelEditor.classList.add("hidden");
        formEditarModulo?.classList.add("hidden");
        formEditarSubtitulo?.classList.add("hidden");
        archivosEditSub = [];
        fotosEditActuales = [];
        if (editSubPreview) editSubPreview.innerHTML = "";
        if (editSubEstadoFotos) editSubEstadoFotos.textContent = "";
    }

    btnCerrarEditor?.addEventListener("click", cerrarEditorCurso);
    btnCancelarEdicionSub?.addEventListener("click", cerrarEditorCurso);

    function abrirEditorModulo(modId) {
        const mod = listaModulos.find(m => m.id === modId);
        if (!mod || !panelEditor || !formEditarModulo) return;
        panelEditor.classList.remove("hidden");
        formEditarSubtitulo?.classList.add("hidden");
        formEditarModulo.classList.remove("hidden");
        tituloEditor.textContent = `Editar módulo: ${mod.titulo}`;
        $("edit_mod_id").value = mod.id;
        $("edit_mod_titulo").value = mod.titulo || "";
        $("edit_mod_orden").value = mod.orden || 1;
        panelEditor.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function abrirEditorSubtitulo(modId, idx) {
        const mod = listaModulos.find(m => m.id === modId);
        const sub = mod?.subtitulos?.[idx];
        if (!mod || !sub || !panelEditor || !formEditarSubtitulo) return;
        panelEditor.classList.remove("hidden");
        formEditarModulo?.classList.add("hidden");
        formEditarSubtitulo.classList.remove("hidden");
        tituloEditor.textContent = `Editar tema: ${sub.titulo}`;
        $("edit_sub_mod_id").value = modId;
        $("edit_sub_idx").value = String(idx);
        $("edit_sub_titulo").value = sub.titulo || "";
        $("edit_sub_contenido").value = sub.contenido || "";
        fotosEditActuales = Array.isArray(sub.fotos) ? sub.fotos.map(f => ({ ...f })) : [];
        archivosEditSub = [];
        if (editSubPreview) editSubPreview.innerHTML = "";
        if (editSubEstadoFotos) editSubEstadoFotos.textContent = "";
        renderFotosEditActuales();
        panelEditor.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (btnToggleCreador && panelCreador) {
        btnToggleCreador.addEventListener("click", () => {
            panelCreador.classList.toggle("hidden");
            const abierto = !panelCreador.classList.contains("hidden");
            btnToggleCreador.textContent = abierto
                ? "✖ Cerrar formulario"
                : "＋ Crear nuevo módulo o tema";
        });
    }

    const qCursos = query(collection(db, "cursos"), orderBy("orden", "asc"));
    onSnapshot(qCursos, snapshot => {
        listaModulos = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));
        actualizarSelectorModulos();
        renderizarModulosCurso();
    }, error => {
        console.error("Error cargando cursos:", error);
        contenedorModulos.innerHTML = `<div class="message error">No se pudieron cargar los módulos: ${escapar(error.message)}</div>`;
    });

    function actualizarSelectorModulos() {
        if (!selectModulos) return;
        const valorAnterior = selectModulos.value;
        if (!listaModulos.length) {
            selectModulos.innerHTML = `<option value="">Primero crea un módulo...</option>`;
            return;
        }
        selectModulos.innerHTML = listaModulos.map(m =>
            `<option value="${escapar(m.id)}">${escapar(m.titulo)}</option>`
        ).join("");
        if (valorAnterior && listaModulos.some(m => m.id === valorAnterior)) {
            selectModulos.value = valorAnterior;
        }
    }

    function renderizarModulosCurso() {
        if (!listaModulos.length) {
            contenedorModulos.innerHTML = `
                <div class="card">
                    <p class="muted">Aún no hay módulos creados. Usa el botón superior <strong>"＋ Crear nuevo módulo o tema"</strong> para empezar.</p>
                </div>
            `;
            return;
        }
        contenedorModulos.innerHTML = listaModulos.map(mod => {
            const subtitulos = Array.isArray(mod.subtitulos) ? mod.subtitulos : [];
            const modAbierto = modulosAbiertos.has(mod.id);
            return `
                <div class="curso-modulo-card ${modAbierto ? "abierto" : ""}" data-modulo-id="${escapar(mod.id)}">
                    <div class="curso-modulo-top-bar">
                        <button type="button" class="curso-modulo-header">
                            <div class="curso-modulo-izq">
                                <div class="curso-modulo-icono-lista">☰</div>
                                <h3 class="curso-modulo-titulo">${escapar(mod.titulo)}</h3>
                            </div>
                            <div class="curso-modulo-flecha">▼</div>
                        </button>
                        <div class="curso-modulo-acciones-top">
                            <button type="button" class="curso-btn-mini-edit btn-editar-mod" data-mod="${escapar(mod.id)}">
                                ✏️ Editar módulo
                            </button>
                            <button type="button" class="curso-btn-mini-del btn-borrar-mod" data-mod="${escapar(mod.id)}">
                                🗑 Eliminar
                            </button>
                        </div>
                    </div>
                    <div class="curso-subtitulos-lista ${modAbierto ? "" : "hidden"}">
                        ${subtitulos.length ? subtitulos.map((sub, idx) => {
                            const claveTema = `${mod.id}__${idx}`;
                            const temaAbierto = temasAbiertos.has(claveTema);
                            const fotosTema = Array.isArray(sub.fotos) ? sub.fotos : [];
                            return `
                                <div class="curso-subtitulo-item ${temaAbierto ? "activo" : ""}">
                                    <button type="button" class="curso-subtitulo-btn">
                                        <div class="curso-subtitulo-izq">
                                            <span class="curso-subtitulo-circulo">›</span>
                                            <span>${escapar(sub.titulo)}</span>
                                        </div>
                                    </button>
                                    <div class="curso-subtitulo-contenido ${temaAbierto ? "" : "hidden"}">
                                        <div class="curso-prosa">${formatearTextoEnProsa(sub.contenido)}</div>
                                        ${fotosTema.length ? `
                                            <div class="curso-galeria">
                                                ${fotosTema.map(f => `
                                                    <div class="curso-foto-card">
                                                        <img src="${escapar(f.url)}" alt="${escapar(f.descripcion || f.nombre || sub.titulo)}" loading="lazy" class="curso-foto-ampliable" data-desc="${escapar(f.descripcion || "")}">
                                                        ${f.descripcion ? `<p class="curso-foto-desc">${escapar(f.descripcion)}</p>` : ""}
                                                    </div>
                                                `).join("")}
                                            </div>
                                        ` : ""}
                                        <div class="curso-acciones-admin">
                                            <button type="button" class="curso-btn-mini-edit btn-editar-sub" data-mod="${escapar(mod.id)}" data-idx="${idx}">
                                                ✏️ Editar tema
                                            </button>
                                            <button type="button" class="curso-btn-mini-del btn-borrar-sub" data-mod="${escapar(mod.id)}" data-idx="${idx}">
                                                🗑 Eliminar tema
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join("") : `
                            <div style="padding: 16px 24px;" class="muted">
                                Este módulo aún no tiene subtítulos agregados.
                            </div>
                        `}
                    </div>
                </div>
            `;
        }).join("");
    }

    contenedorModulos.addEventListener("click", async e => {
        const imgAmpliable = e.target.closest("img.curso-foto-ampliable");
        if (imgAmpliable) {
            abrirLightbox(imgAmpliable.src, imgAmpliable.dataset.desc || "", imgAmpliable.alt);
            return;
        }

        const btnEditarMod = e.target.closest(".btn-editar-mod");
        if (btnEditarMod) {
            abrirEditorModulo(btnEditarMod.dataset.mod);
            return;
        }

        const btnEditarSub = e.target.closest(".btn-editar-sub");
        if (btnEditarSub) {
            abrirEditorSubtitulo(btnEditarSub.dataset.mod, Number(btnEditarSub.dataset.idx));
            return;
        }

        const headerModulo = e.target.closest(".curso-modulo-header");
        if (headerModulo) {
            const tarjeta = headerModulo.closest(".curso-modulo-card");
            const modId = tarjeta.dataset.moduloId;
            const listaSub = tarjeta.querySelector(".curso-subtitulos-lista");
            tarjeta.classList.toggle("abierto");
            listaSub.classList.toggle("hidden");
            if (tarjeta.classList.contains("abierto")) {
                modulosAbiertos.add(modId);
            } else {
                modulosAbiertos.delete(modId);
            }
            return;
        }

        const btnSub = e.target.closest(".curso-subtitulo-btn");
        if (btnSub) {
            const tarjeta = btnSub.closest(".curso-modulo-card");
            const itemSub = btnSub.closest(".curso-subtitulo-item");
            const contenido = itemSub.querySelector(".curso-subtitulo-contenido");
            const modId = tarjeta?.dataset.moduloId || "";
            const idxBtn = Array.from(tarjeta.querySelectorAll(".curso-subtitulo-item")).indexOf(itemSub);
            const clave = `${modId}__${idxBtn}`;
            itemSub.classList.toggle("activo");
            contenido.classList.toggle("hidden");
            if (itemSub.classList.contains("activo")) {
                temasAbiertos.add(clave);
            } else {
                temasAbiertos.delete(clave);
            }
            return;
        }

        const btnBorrarSub = e.target.closest(".btn-borrar-sub");
        if (btnBorrarSub) {
            const modId = btnBorrarSub.dataset.mod;
            const idx = Number(btnBorrarSub.dataset.idx);
            if (!confirm("¿Eliminar este subtítulo?")) return;
            try {
                const modActual = listaModulos.find(m => m.id === modId);
                if (!modActual) return;
                const nuevosSub = (modActual.subtitulos || []).filter((_, i) => i !== idx);
                await updateDoc(doc(db, "cursos", modId), { subtitulos: nuevosSub });
            } catch (err) {
                alert("Error al eliminar subtítulo: " + err.message);
            }
            return;
        }

        const btnBorrarMod = e.target.closest(".btn-borrar-mod");
        if (btnBorrarMod) {
            const modId = btnBorrarMod.dataset.mod;
            if (!confirm("¿Seguro que deseas eliminar todo este módulo y sus temas?")) return;
            try {
                await deleteDoc(doc(db, "cursos", modId));
                modulosAbiertos.delete(modId);
            } catch (err) {
                alert("Error al eliminar módulo: " + err.message);
            }
        }
    });

    if (formModulo) {
        formModulo.addEventListener("submit", async e => {
            e.preventDefault();
            const titulo = $("c_mod_titulo").value.trim();
            const orden = Number($("c_mod_orden").value) || 1;
            if (!titulo) return;
            try {
                const nuevoId = "MOD-" + Date.now();
                await setDoc(doc(db, "cursos", nuevoId), {
                    titulo,
                    orden,
                    subtitulos: [],
                    creado: Date.now()
                });
                modulosAbiertos.add(nuevoId);
                formModulo.reset();
                $("c_mod_orden").value = listaModulos.length + 2;
                mostrarMensaje("msgCurso", "Módulo creado correctamente.", "success");
            } catch (err) {
                mostrarMensaje("msgCurso", "Error al crear módulo: " + err.message, "error");
            }
        });
    }

    if (formSubtitulo) {
        formSubtitulo.addEventListener("submit", async e => {
            e.preventDefault();
            const modId = selectModulos.value;
            const titulo = $("c_sub_titulo").value.trim();
            const contenido = $("c_sub_contenido").value.trim();
            if (!modId || !titulo || !contenido) return;

            establecerCarga(btnGuardarSubtitulo, true, "Agregar Subtítulo");
            try {
                const fotosSubidas = archivosNuevoSub.length
                    ? await subirArchivosCursoAGoogleDrive(archivosNuevoSub, modId, estadoFotosNuevo)
                    : [];

                await updateDoc(doc(db, "cursos", modId), {
                    subtitulos: arrayUnion({
                        titulo,
                        contenido,
                        fotos: fotosSubidas,
                        creado: Date.now()
                    })
                });
                modulosAbiertos.add(modId);
                formSubtitulo.reset();
                selectModulos.value = modId;
                archivosNuevoSub = [];
                if (previewFotosNuevo) previewFotosNuevo.innerHTML = "";
                if (estadoFotosNuevo) estadoFotosNuevo.textContent = "";
                mostrarMensaje("msgCurso", "Subtítulo agregado al módulo.", "success");
            } catch (err) {
                mostrarMensaje("msgCurso", "Error al agregar subtítulo: " + err.message, "error");
                if (estadoFotosNuevo) estadoFotosNuevo.textContent = "";
            } finally {
                establecerCarga(btnGuardarSubtitulo, false, "Agregar Subtítulo");
            }
        });
    }

    if (formEditarModulo) {
        formEditarModulo.addEventListener("submit", async e => {
            e.preventDefault();
            const modId = $("edit_mod_id").value;
            const titulo = $("edit_mod_titulo").value.trim();
            const orden = Number($("edit_mod_orden").value) || 1;
            if (!modId || !titulo) return;
            try {
                await updateDoc(doc(db, "cursos", modId), {
                    titulo,
                    orden,
                    actualizado: Date.now()
                });
                cerrarEditorCurso();
                mostrarMensaje("msgCurso", "Módulo actualizado correctamente.", "success");
            } catch (err) {
                alert("Error al actualizar módulo: " + err.message);
            }
        });
    }

    if (formEditarSubtitulo) {
        formEditarSubtitulo.addEventListener("submit", async e => {
            e.preventDefault();
            const modId = $("edit_sub_mod_id").value;
            const idx = Number($("edit_sub_idx").value);
            const titulo = $("edit_sub_titulo").value.trim();
            const contenido = $("edit_sub_contenido").value.trim();
            const modActual = listaModulos.find(m => m.id === modId);
            if (!modActual || !Array.isArray(modActual.subtitulos) || !modActual.subtitulos[idx]) return;
            if (!titulo || !contenido) return;

            establecerCarga(btnGuardarEdicionSub, true, "Guardar cambios del tema");
            try {
                const nuevasSubidas = archivosEditSub.length
                    ? await subirArchivosCursoAGoogleDrive(archivosEditSub, modId, editSubEstadoFotos)
                    : [];

                const subOriginal = modActual.subtitulos[idx];
                const actualizados = [...modActual.subtitulos];
                actualizados[idx] = {
                    ...subOriginal,
                    titulo,
                    contenido,
                    fotos: [...fotosEditActuales, ...nuevasSubidas],
                    actualizado: Date.now()
                };

                await updateDoc(doc(db, "cursos", modId), {
                    subtitulos: actualizados
                });
                cerrarEditorCurso();
                mostrarMensaje("msgCurso", "Tema actualizado correctamente.", "success");
            } catch (err) {
                alert("Error al guardar cambios del tema: " + err.message);
                if (editSubEstadoFotos) editSubEstadoFotos.textContent = "";
            } finally {
                establecerCarga(btnGuardarEdicionSub, false, "Guardar cambios del tema");
            }
        });
    }
}

/* =========================
   INICIALIZADOR PARA DETALLE.HTML Y EDITAR.HTML
========================= */
document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const codigoEquipo = params.get("c");
    const path = window.location.pathname;
    if (codigoEquipo && path.includes("detalle.html")) {
        onAuthStateChanged(auth, usuario => {
            if (usuario) {
                abrirDetalle(codigoEquipo, false);
            } else {
                window.location.href = "dispositivos.html";
            }
        });
    }
    if (codigoEquipo && path.includes("editar.html")) {
        onAuthStateChanged(auth, usuario => {
            if (usuario) {
                abrirEdicion(codigoEquipo);
            } else {
                window.location.href = "dispositivos.html";
            }
        });
    }
});
