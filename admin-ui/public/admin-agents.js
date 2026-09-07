/* AI Scholar Hub — Academic Intelligence */
(() => {
  const boot = () => {
    if (typeof currentMe === 'undefined' || !currentMe)
      return setTimeout(boot, 200);

    const role = String(currentMe.role || '').toUpperCase();

    if (![
      'SUPERADMIN',
      'PLATFORM_ADMIN',
      'ADMIN',
      'INSTITUTION_ADMIN'
    ].includes(role)) return;

    const host = document.getElementById('academicAgentsHost');
    if (!host) return;

    const state = {
      tenantId: String(currentMe.tenantId || ''),
      institutions: [],
      agents: []
    };
    const coreAgentIds = new Set([
      'K12_SOCRATIC_TUTOR',
      'SOCRATIC_TUTOR',
      'RESEARCH_SYNTHESIZER',
      'SEMANTIC_SCHOLAR_SEARCH',
      'LITERATURE_REVIEW',
      'RESEARCH_GAP_FINDER',
      'EDUCATION_CAREER_PATHWAYS',
      'COURSE_KNOWLEDGE'
    ]);

    const esc = v => String(v ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');

    async function api(url, options={}) {
      const r = await fetch(url, {
        credentials:'same-origin',
        ...options
      });

      const d = await r.json().catch(() => ({}));

      if (!r.ok)
        throw new Error(d.error || `Request failed (${r.status})`);

      return d;
    }

    function render() {
      host.className = '';

      host.innerHTML = `
        <div class="panel">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <h2>Academic Agents</h2>
              <div class="muted">
                AI Scholar Hub agents teach, coach and synthesize using explicit pedagogical policies.
              </div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${role === 'INSTITUTION_ADMIN' ? '' : `
                <select id="agentTenant">
                  <option value="">Select institution...</option>
                  ${state.institutions.map(i => `
                    <option value="${esc(i._id)}"
                      ${String(i._id)===state.tenantId?'selected':''}>
                      ${esc(i.name || i._id)}
                    </option>
                  `).join('')}
                </select>
              `}

              <button type="button" class="primary"
                onclick="openAcademicAgentForm()"
                ${state.tenantId ? '' : 'disabled'}>
                + Academic Agent
              </button>
            </div>
          </div>

          <div class="org-grid" style="margin-top:14px">
            ${state.agents.map(a => `
              <div class="org-card">
                <div style="display:flex;justify-content:space-between;gap:8px">
                  <div>
                    <h3>${esc(a.name)}</h3>
                    <div class="org-small">
                      ${esc(a.agentId)} • ${esc(a.modelSpecName)}
                    </div>
                  </div>

                  <span class="org-tag ${a.enabled!==false?'org-enabled':'org-disabled'}">
                    ${a.enabled!==false?'Enabled':'Disabled'}
                  </span>
                  ${coreAgentIds.has(a.agentId)
                    ? '<span class="org-tag">Core</span>'
                    : ''}
                </div>

                <p class="muted">${esc(a.description || '')}</p>

                <div>
                  <span class="org-tag">
                    ${esc(a.pedagogy?.mode || 'SOCRATIC')}
                  </span>

                  ${(a.allowedRoles || []).map(r =>
                    `<span class="org-tag">${esc(r)}</span>`
                  ).join('')}
                </div>

                <div class="org-small" style="margin-top:8px">
                  ${esc(a.pedagogy?.strategy || '')}
                </div>

                <div class="org-toolbar">
                  <button type="button"
                    onclick="openAcademicAgentForm('${esc(a._id)}')">
                    Edit
                  </button>

                  ${coreAgentIds.has(a.agentId) ? '' : `
                    <button type="button" class="danger"
                      onclick="deleteAcademicAgent('${esc(a._id)}')">
                      Delete
                    </button>
                  `}
                </div>
              </div>
            `).join('') || `
              <div class="org-card">
                <div class="muted">
                  No Academic Agents configured for this institution.
                </div>
              </div>
            `}
          </div>
        </div>
      `;

      const tenant = document.getElementById('agentTenant');

      if (tenant) {
        tenant.onchange = async () => {
          state.tenantId = tenant.value;
          await loadAgents();
        };
      }
    }

    function popup(title, body, save) {
      const d = document.createElement('dialog');

      d.innerHTML = `
        <form class="org-form-grid">
          <h3>${esc(title)}</h3>
          ${body}

          <div style="display:flex;gap:8px">
            <button class="primary">Save</button>
            <button type="button"
              onclick="this.closest('dialog').close()">
              Cancel
            </button>
          </div>
        </form>
      `;

      document.body.appendChild(d);

      d.querySelector('form').onsubmit = async e => {
        e.preventDefault();

        try {
          await save(d.querySelector('form'));
          d.close();
          await loadAgents();
        } catch (err) {
          alert(err.message);
        }
      };

      d.addEventListener('close', () => d.remove(), {once:true});
      d.showModal();
    }

    window.openAcademicAgentForm = agentId => {
      const existing = state.agents.find(
        a => String(a._id) === String(agentId)
      );

      popup(
        existing ? 'Edit Academic Agent' : 'Create Academic Agent',
        `
          <input name="agentId"
            ${existing ? 'readonly' : ''}
            required
            value="${esc(existing?.agentId || '')}"
            placeholder="Agent ID, e.g. WRITING_COACH">

          <input name="name"
            required
            value="${esc(existing?.name || '')}"
            placeholder="Agent name">

          <input name="modelSpecName"
            required
            value="${esc(existing?.modelSpecName || '')}"
            placeholder="AIH modelSpec name">

          <textarea name="description"
            placeholder="Description">${esc(existing?.description || '')}</textarea>

          <label class="muted">Pedagogical mode</label>
          <select name="mode">
            ${[
              'SOCRATIC',
              'RESEARCH',
              'EXPLAINER',
              'WRITING_COACH',
              'PROBLEM_SOLVING',
              'ASSESSMENT',
              'STUDY_COACH'
            ].map(x => `
              <option ${existing?.pedagogy?.mode===x?'selected':''}>
                ${x}
              </option>
            `).join('')}
          </select>

          <label class="muted">Allowed roles</label>
          <select name="allowedRoles" multiple>
            ${['USER','INSTRUCTOR','INSTITUTION_ADMIN']
              .map(r => `
                <option value="${r}"
                  ${(existing?.allowedRoles || []).includes(r)
                    ? 'selected' : ''}>
                  ${r}
                </option>
              `).join('')}
          </select>

          <textarea name="strategy"
            placeholder="Pedagogical strategy">${esc(existing?.pedagogy?.strategy || '')}</textarea>

          <label>
            <input type="checkbox" name="enabled"
              ${existing?.enabled !== false ? 'checked' : ''}>
            Enabled
          </label>

          <label>
            <input type="checkbox"
              name="diagnoseFirst"
              ${existing?.pedagogy?.diagnoseFirst !== false ? 'checked' : ''}>
            Diagnose before teaching
          </label>

          <label>
            <input type="checkbox"
              name="activeRetrieval"
              ${existing?.pedagogy?.activeRetrieval !== false ? 'checked' : ''}>
            Active retrieval
          </label>

          <label>
            <input type="checkbox"
              name="adaptiveDifficulty"
              ${existing?.pedagogy?.adaptiveDifficulty !== false ? 'checked' : ''}>
            Adaptive difficulty
          </label>

          <label>
            <input type="checkbox"
              name="misconceptionRepair"
              ${existing?.pedagogy?.misconceptionRepair !== false ? 'checked' : ''}>
            Misconception repair
          </label>

          <label>
            <input type="checkbox"
              name="masteryTracking"
              ${existing?.pedagogy?.masteryTracking !== false ? 'checked' : ''}>
            Mastery-aware instruction
          </label>
        `,
        async f => {
          const roles = [
            ...f.querySelector('[name="allowedRoles"]').selectedOptions
          ].map(o => o.value);

          const body = {
            tenantId:state.tenantId,
            agentId:f.agentId.value,
            name:f.name.value,
            modelSpecName:f.modelSpecName.value,
            description:f.description.value,
            allowedRoles:roles,
            enabled:f.enabled.checked,
            pedagogy:{
              mode:f.mode.value,
              strategy:f.strategy.value,
              diagnoseFirst:f.diagnoseFirst.checked,
              activeRetrieval:f.activeRetrieval.checked,
              adaptiveDifficulty:f.adaptiveDifficulty.checked,
              misconceptionRepair:f.misconceptionRepair.checked,
              masteryTracking:f.masteryTracking.checked
            }
          };

          await api(
            existing
              ? `/api/academic-agents/${encodeURIComponent(existing._id)}`
              : '/api/academic-agents',
            {
              method:existing ? 'PATCH' : 'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify(body)
            }
          );
        }
      );
    };

    window.deleteAcademicAgent = async agentId => {
      if (!confirm('Delete this Academic Agent?')) return;

      try {
        await api(
          `/api/academic-agents/${encodeURIComponent(agentId)}`,
          {method:'DELETE'}
        );

        await loadAgents();
      } catch (e) {
        alert(e.message);
      }
    };

    async function loadAgents() {
      if (!state.tenantId) {
        state.agents = [];
        render();
        return;
      }

      const data = await api(
        `/api/academic-agents?tenantId=${encodeURIComponent(state.tenantId)}`
      );

      state.agents = data.agents || [];
      render();
    }

    async function load() {
      if (role !== 'INSTITUTION_ADMIN') {
        const d = await fetch('/api/ai-policy/catalog', {
          credentials:'same-origin'
        }).then(async r => {
          const x = await r.json();
          if (!r.ok) throw new Error(x.error || 'Failed to load institutions');
          return x;
        });

        state.institutions = d.institutions || [];

        if (!state.tenantId && state.institutions.length)
          state.tenantId = String(state.institutions[0]._id);
      }

      await loadAgents();
    }

    load().catch(e => {
      host.innerHTML = `
        <div class="admin-placeholder">
          <h2>Academic Agents</h2>
          <div style="color:#a00">${esc(e.message)}</div>
        </div>
      `;
    });
  };

  boot();
})();
