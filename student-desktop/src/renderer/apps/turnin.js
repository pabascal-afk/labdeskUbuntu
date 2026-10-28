// LabDesk - Manejador Nativo de Entregas al Profesor (Mini Editores)
window.LabDeskTurnIn = {
    currentConfig: null,
    activeAssignment: null,
    courses: [],
    students: [],
    selectedMembers: [],
    templateLoaded: false,
    activityInterval: null,

    getAPI() {
        if (window.labdeskAPI && window.labdeskAPI.turnIn) return window.labdeskAPI;
        if (window.parent && window.parent.labdeskAPI && window.parent.labdeskAPI.turnIn) return window.parent.labdeskAPI;
        return null;
    },

    registerApp(config) {
        this.currentConfig = config || {};
        const api = this.getAPI();
        if (!api) return;

        // Verificar si hay tarea activa con plantilla
        api.turnIn.getActiveAssignment().then(actData => {
            if (actData && actData.active && actData.assignment) {
                this.activeAssignment = actData.assignment;
                if (this.activeAssignment.template_file_path && !this.templateLoaded && typeof this.currentConfig.setContent === 'function') {
                    api.turnIn.fetchTemplate(this.activeAssignment.template_file_path).then(res => {
                        if (res && res.success && res.data) {
                            this.currentConfig.setContent(res.data);
                            this.templateLoaded = true;
                        }
                    }).catch(() => {});
                }
            }
        }).catch(() => {});

        // Escuchar devoluciones de tarea en tiempo real
        if (api.turnIn.onAssignmentReturned) {
            api.turnIn.onAssignmentReturned((sub) => {
                this.handleAssignmentReturned(sub);
            });
        }

        // Escuchar fin de tiempo para auto-entrega
        if (api.turnIn.onAssignmentTimeUp) {
            api.turnIn.onAssignmentTimeUp((info) => {
                this.handleAssignmentTimeUp(info);
            });
        }
    },

    handleAssignmentReturned(sub) {
        const feedback = sub.feedback || 'Tu profesor te ha devuelto el trabajo para realizar correcciones.';
        alert(`↩️ OBSERVACIÓN DE TU PROFESOR:\n\n"${feedback}"\n\nVamos a cargar tu entrega previa para que puedas corregirla.`);
        if (sub.filePath && typeof this.currentConfig?.setContent === 'function') {
            const api = this.getAPI();
            if (api && api.turnIn && api.turnIn.fetchTemplate) {
                api.turnIn.fetchTemplate(sub.filePath).then(res => {
                    if (res && res.success && res.data) {
                        this.currentConfig.setContent(res.data);
                    }
                }).catch(() => {});
            }
        }
    },

    handleAssignmentTimeUp(info) {
        if (!this.activeAssignment || this.activeAssignment.id !== info.assignmentId) return;
        alert('⏰ ¡TIEMPO LÍMITE ALCANZADO!\n\nEl profesor ha cerrado el tiempo de la tarea. Procediendo a enviar tu avance actual automáticamente.');
        const mainStudent = (this.selectedMembers && this.selectedMembers[0]) || 'Estudiante';
        this.submit();
    },

    async open(config) {
        this.currentConfig = config || {};
        this.selectedMembers = [];
        this.buildModalDOM();

        const api = this.getAPI();
        if (!api) {
            alert('⚠️ No se detectó conexión con el entorno LabDesk.');
            return;
        }

        // Mostrar modal en estado de carga inicial
        const overlay = document.getElementById('turnin-overlay');
        overlay.style.display = 'flex';
        this.setStatus('Cargando información del profesor y curso...', '#3b82f6');

        try {
            // Consultar tarea activa
            const actData = await api.turnIn.getActiveAssignment();
            if (actData && actData.active && actData.assignment) {
                this.activeAssignment = actData.assignment;
                this.renderActiveBanner(this.activeAssignment);
            } else {
                this.activeAssignment = null;
                this.hideActiveBanner();
            }

            // Consultar cursos
            this.courses = await api.turnIn.getCourses() || [];
            this.populateCourses();

            // Si hay tarea activa con curso específico
            if (this.activeAssignment && this.activeAssignment.course_id) {
                const courseSelect = document.getElementById('turnin-course-select');
                courseSelect.value = this.activeAssignment.course_id;
                courseSelect.disabled = true; // Bloqueado al curso de la tarea
                await this.onCourseSelected(this.activeAssignment.course_id, this.activeAssignment.students);
            } else if (this.courses.length > 0) {
                const courseSelect = document.getElementById('turnin-course-select');
                courseSelect.disabled = false;
                await this.onCourseSelected(this.courses[0].id);
            }

            this.updateGroupUI();
            this.clearStatus();
        } catch (err) {
            console.error('Error cargando datos de entrega:', err);
            this.setStatus('Error conectando con el servidor. Puedes escribir tu nombre manualmente.', '#ef4444');
            this.toggleManualName(true);
        }
    },

    buildModalDOM() {
        if (document.getElementById('turnin-overlay')) return;

        const html = `
        <div id="turnin-overlay" class="turnin-overlay" style="display:none;">
            <div class="turnin-card">
                <div class="turnin-header">
                    <h3><span>📥</span> Entregar Trabajo al Profesor</h3>
                    <button class="turnin-close" onclick="LabDeskTurnIn.close()">&times;</button>
                </div>
                <div class="turnin-body">
                    <!-- Banner de Tarea Activa -->
                    <div id="turnin-banner" class="turnin-active-banner" style="display:none;">
                        <div class="turnin-active-badge">📋 TAREA ASIGNADA EN LA SALA</div>
                        <div id="turnin-banner-title" class="turnin-active-title">Título</div>
                        <div id="turnin-banner-meta" class="turnin-active-meta">Curso • Profesor</div>
                    </div>

                    <!-- Selector de Curso -->
                    <div class="turnin-group" id="turnin-course-group">
                        <label class="turnin-label">Curso:</label>
                        <select id="turnin-course-select" class="turnin-select" onchange="LabDeskTurnIn.onCourseChange(this.value)">
                            <option value="">Selecciona tu curso...</option>
                        </select>
                    </div>

                    <!-- Selector de Alumno Principal del Pool -->
                    <div class="turnin-group">
                        <label class="turnin-label">Tu Nombre (Estudiante):</label>
                        <select id="turnin-student-select" class="turnin-select" onchange="LabDeskTurnIn.onMainStudentChange(this.value)">
                            <option value="">Selecciona tu nombre del listado...</option>
                        </select>
                        <div style="margin-top:2px; text-align:right;">
                            <a href="javascript:void(0)" onclick="LabDeskTurnIn.toggleManualName()" style="font-size:11px; color:#60a5fa; text-decoration:none;">
                                ✍️ ¿No estás en la lista? Escribir a mano
                            </a>
                        </div>
                        <input type="text" id="turnin-manual-input" class="turnin-input" placeholder="Escribe tu Nombre y Apellido" style="display:none; margin-top:4px;">
                    </div>

                    <!-- Sección Grupal -->
                    <div id="turnin-group-box" class="turnin-group-box">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label class="turnin-label" style="margin:0;">👥 Integrantes del Grupo:</label>
                            <span id="turnin-group-counter" style="font-size:11px; color:#94a3b8;">1 integrante</span>
                        </div>
                        <div id="turnin-chips" class="turnin-chips-list">
                            <!-- Chips dinámicos -->
                        </div>
                        <div style="display:flex; gap:6px; margin-top:4px;">
                            <select id="turnin-add-member-select" class="turnin-select" style="font-size:12px;">
                                <option value="">+ Añadir compañero...</option>
                            </select>
                            <button type="button" class="turnin-btn turnin-btn-secondary" onclick="LabDeskTurnIn.addMember()" style="padding:6px 12px; font-size:12px;">
                                + Agregar
                            </button>
                        </div>
                    </div>

                    <!-- Comentario Opcional -->
                    <div class="turnin-group">
                        <label class="turnin-label">Mensaje o Comentario (Opcional):</label>
                        <input type="text" id="turnin-notes-input" class="turnin-input" placeholder="Ej: Trabajo terminado, actividad completa...">
                    </div>

                    <div id="turnin-status-msg" style="display:none;"></div>
                </div>
                <div class="turnin-footer">
                    <button class="turnin-btn turnin-btn-secondary" onclick="LabDeskTurnIn.close()">Cancelar</button>
                    <button class="turnin-btn turnin-btn-success" id="turnin-btn-submit" onclick="LabDeskTurnIn.submit()">
                        🚀 Confirmar Entrega
                    </button>
                </div>
            </div>
        </div>`;

        const div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
    },

    renderActiveBanner(assignment) {
        const banner = document.getElementById('turnin-banner');
        if (!banner) return;
        banner.style.display = 'block';
        document.getElementById('turnin-banner-title').textContent = assignment.title;
        document.getElementById('turnin-banner-meta').textContent = `${assignment.course_name || 'Curso'} • Profesor: ${assignment.teacher_name || 'Docente'}`;
    },

    hideActiveBanner() {
        const banner = document.getElementById('turnin-banner');
        if (banner) banner.style.display = 'none';
        const courseSelect = document.getElementById('turnin-course-select');
        if (courseSelect) courseSelect.disabled = false;
    },

    populateCourses() {
        const select = document.getElementById('turnin-course-select');
        if (!select) return;
        select.innerHTML = '<option value="">Selecciona tu curso...</option>';
        this.courses.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.name} (${c.student_count || 0} alumnos)`;
            select.appendChild(opt);
        });
    },

    async onCourseChange(courseId) {
        if (!courseId) {
            this.students = [];
            this.populateStudents();
            return;
        }
        await this.onCourseSelected(courseId);
    },

    async onCourseSelected(courseId, preloadedStudents) {
        const api = this.getAPI();
        if (preloadedStudents && preloadedStudents.length > 0) {
            this.students = preloadedStudents;
        } else if (api) {
            this.students = await api.turnIn.getStudents(courseId) || [];
        }
        this.populateStudents();
    },

    populateStudents() {
        const select = document.getElementById('turnin-student-select');
        const addSelect = document.getElementById('turnin-add-member-select');
        if (!select || !addSelect) return;

        select.innerHTML = '<option value="">Selecciona tu nombre del listado...</option>';
        addSelect.innerHTML = '<option value="">+ Añadir compañero de grupo...</option>';

        this.students.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.full_name;
            opt.textContent = s.full_name;
            select.appendChild(opt);

            const opt2 = document.createElement('option');
            opt2.value = s.full_name;
            opt2.textContent = s.full_name;
            addSelect.appendChild(opt2);
        });
    },

    onMainStudentChange(studentName) {
        if (studentName) {
            // Actualizar integrantes: el alumno principal siempre es el primero
            if (this.selectedMembers.length === 0) {
                this.selectedMembers.push(studentName);
            } else {
                this.selectedMembers[0] = studentName;
            }

            // Reportar telemetría de alumno trabajando
            if (this.activeAssignment) {
                const api = this.getAPI();
                const studentObj = (this.students || []).find(s => s.full_name === studentName);
                if (api && api.turnIn && api.turnIn.reportActivity) {
                    api.turnIn.reportActivity({
                        assignmentId: this.activeAssignment.id,
                        studentId: studentObj ? studentObj.id : 0,
                        studentName: studentName,
                        status: 'working',
                        metrics: typeof this.currentConfig?.getMetrics === 'function' ? this.currentConfig.getMetrics() : null
                    });
                }
            }
        }
        this.renderChips();
    },

    addMember() {
        const addSelect = document.getElementById('turnin-add-member-select');
        const name = addSelect.value;
        if (!name) return;

        if (this.selectedMembers.includes(name)) {
            alert('Este compañero ya está agregado al grupo.');
            return;
        }

        const maxGroup = (this.activeAssignment && this.activeAssignment.max_group_size) ? this.activeAssignment.max_group_size : 6;
        if (this.selectedMembers.length >= maxGroup) {
            alert(`El límite máximo para este trabajo es de ${maxGroup} integrantes.`);
            return;
        }

        this.selectedMembers.push(name);
        addSelect.value = '';
        this.renderChips();
    },

    removeMember(index) {
        if (index === 0) {
            // Quitar el principal borra el select principal
            this.selectedMembers.splice(0, 1);
            document.getElementById('turnin-student-select').value = '';
        } else {
            this.selectedMembers.splice(index, 1);
        }
        this.renderChips();
    },

    renderChips() {
        const container = document.getElementById('turnin-chips');
        const counter = document.getElementById('turnin-group-counter');
        if (!container) return;

        container.innerHTML = '';
        this.selectedMembers.forEach((m, idx) => {
            const chip = document.createElement('div');
            chip.className = 'turnin-chip';
            chip.innerHTML = `
                <span>${idx === 0 ? '👑' : '👤'} ${m}</span>
                <button type="button" class="turnin-chip-remove" onclick="LabDeskTurnIn.removeMember(${idx})">&times;</button>
            `;
            container.appendChild(chip);
        });

        const count = this.selectedMembers.length;
        if (counter) {
            counter.textContent = `${count} integrante${count === 1 ? '' : 's'}`;
        }
    },

    updateGroupUI() {
        const groupBox = document.getElementById('turnin-group-box');
        if (!groupBox) return;
        // Si hay una tarea individual estricta
        if (this.activeAssignment && this.activeAssignment.is_group === 0) {
            groupBox.style.display = 'none';
        } else {
            groupBox.style.display = 'flex';
        }
    },

    toggleManualName(forceManual) {
        const manualInput = document.getElementById('turnin-manual-input');
        const studentSelect = document.getElementById('turnin-student-select');
        const isHidden = manualInput.style.display === 'none';
        const show = forceManual !== undefined ? forceManual : isHidden;

        if (show) {
            manualInput.style.display = 'block';
            studentSelect.style.display = 'none';
            manualInput.focus();
        } else {
            manualInput.style.display = 'none';
            studentSelect.style.display = 'block';
        }
    },

    setStatus(text, color) {
        const msg = document.getElementById('turnin-status-msg');
        if (!msg) return;
        msg.style.display = 'block';
        msg.textContent = text;
        msg.style.color = color || '#cbd5e1';
    },

    clearStatus() {
        const msg = document.getElementById('turnin-status-msg');
        if (msg) msg.style.display = 'none';
    },

    async submit() {
        const manualInput = document.getElementById('turnin-manual-input');
        const isManual = manualInput && manualInput.style.display !== 'none';
        let mainStudent = '';

        if (isManual) {
            mainStudent = manualInput.value.trim();
        } else {
            mainStudent = document.getElementById('turnin-student-select').value.trim();
        }

        if (!mainStudent) {
            alert('⚠️ Por favor selecciona o escribe tu nombre para la entrega.');
            return;
        }

        // Asegurar que el principal esté en members
        if (!this.selectedMembers.includes(mainStudent)) {
            this.selectedMembers.unshift(mainStudent);
        }

        const courseSelect = document.getElementById('turnin-course-select');
        const courseName = courseSelect.options[courseSelect.selectedIndex]?.text.replace(/\s*\(\d+\s*alumnos\)/, '') || 'Curso General';
        const notes = document.getElementById('turnin-notes-input').value.trim();

        // Obtener datos del documento desde la configuración
        const filename = typeof this.currentConfig.getFilename === 'function'
            ? this.currentConfig.getFilename(mainStudent)
            : `trabajo_${mainStudent.replace(/\s+/g, '_')}.html`;

        const content = typeof this.currentConfig.getContent === 'function'
            ? this.currentConfig.getContent()
            : '';

        const appType = this.currentConfig.appType || 'Mini Writer';
        const assignmentId = this.activeAssignment ? this.activeAssignment.id : null;

        const btnSubmit = document.getElementById('turnin-btn-submit');
        btnSubmit.disabled = true;
        btnSubmit.textContent = '⏳ Enviando al profesor...';
        this.setStatus('Subiendo entrega al servidor del profesor...', '#3b82f6');

        try {
            const api = this.getAPI();
            const res = await api.turnIn.submitAssignment({
                assignmentId,
                filename,
                content,
                appType,
                courseName,
                studentNames: this.selectedMembers,
                mainStudentName: mainStudent,
                notes
            });

            if (res && res.success) {
                this.setStatus('🎉 ¡Tu trabajo ha sido entregado exitosamente al profesor!', '#10b981');
                btnSubmit.textContent = '✅ ¡Entregado!';
                setTimeout(() => {
                    this.close();
                    if (typeof this.currentConfig.onSuccess === 'function') {
                        this.currentConfig.onSuccess(res);
                    }
                }, 2000);
            } else {
                throw new Error((res && res.error) || 'Servidor no disponible');
            }
        } catch (err) {
            console.error('Error entregando trabajo:', err);
            this.setStatus('❌ Error al entregar: ' + err.message, '#ef4444');
            btnSubmit.disabled = false;
            btnSubmit.textContent = '🚀 Reintentar Entrega';
        }
    },

    close() {
        const overlay = document.getElementById('turnin-overlay');
        if (overlay) overlay.style.display = 'none';
        const btnSubmit = document.getElementById('turnin-btn-submit');
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.textContent = '🚀 Confirmar Entrega';
        }
        this.clearStatus();
    }
};
