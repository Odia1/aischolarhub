/* AI Scholar Hub — AI Models & Provider Policy */
(() => {
  const boot = () => {
    if (typeof currentMe === 'undefined' || !currentMe)
      return setTimeout(boot, 200);

    const role = String(currentMe.role || '').toUpperCase();

    if (
      currentMe.superAdmin !== true &&
      !['SUPERADMIN','PLATFORM_ADMIN','ADMIN'].includes(role)
    ) return;

    const host = document.getElementById('modelEntitlementHost');
    if (!host) return;

    const state = {
      institutions: [],
      providers: [],
      models: [],
      entitlements: [],
      agents: [],
      personaRoutes: [],
      classComposition: [],
      routeValidation: [],
      validatedAt: null,
      tenantId: ''
    };

    const esc = v => String(v ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');

    const id = x => String(x?._id || '');

    async function call(url, options={}) {
      const r = await fetch(url, {
        credentials: 'same-origin',
        ...options
      });

      const data = await r.json().catch(() => ({}));

      if (!r.ok)
        throw new Error(data.error || `Request failed (${r.status})`);

      return data;
    }

    function modelKey(m) {
      return `${m.providerKey}:${m.model}`;
    }

    function modelLabel(reference) {
      const model = state.models.find(item => modelKey(item) === reference);
      return model?.label || reference || 'None';
    }

    function modelOptions(selected=[]) {
      const chosen = new Set((selected || []).map(String));

      return state.models
        .filter(m => m.enabled !== false && m.managed === true)
        .map(m => {
          const key = modelKey(m);
          return `<option value="${esc(key)}"
            ${chosen.has(key) ? 'selected' : ''}>
            ${esc(m.label || m.model)} — ${esc(m.providerKey)}
            [${esc(m.costTier || 'BALANCED')}]
          </option>`;
        }).join('');
    }

    function providerRows() {
      return state.providers.map(p => `
        <div class="org-row">
          <div>
            <b>${esc(p.name)}</b>
            <div class="org-small">
              ${esc(p.key)} • ${esc(p.endpointType || 'custom')}
              • ${esc(p.costTier || 'BALANCED')}
            </div>
          </div>
          <div>
            <span class="org-tag ${p.enabled !== false ? 'org-enabled' : 'org-disabled'}">
              ${p.enabled !== false ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      `).join('') || '<div class="org-row muted">No providers configured.</div>';
    }

    function modelRows() {
      return state.models.map(m => `
        <div class="org-row">
          <div>
            <b>${esc(m.label || m.model)}</b>
            <div class="org-small">
              ${esc(m.providerKey)}:${esc(m.model)}
              • ${esc(m.costTier || 'BALANCED')}
            </div>
          </div>
          <div>
            <span class="org-tag ${m.enabled !== false ? 'org-enabled' : 'org-disabled'}">
              ${m.enabled !== false ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      `).join('') || '<div class="org-row muted">No models configured.</div>';
    }

    function entitlementRows() {
      return state.entitlements.map(e => `
        <div class="org-row">
          <div>
            <b>${esc(e.role)}</b>
            <div class="org-small">
              Agent: ${esc(e.agentId || '*')}
              • ${esc(e.costTier || 'BALANCED')}
              • ${Array.isArray(e.allowedModels) ? e.allowedModels.length : 0} allowed
            </div>
            <div class="org-small">
              Default: ${esc(modelLabel(e.defaultModel))}
            </div>
          </div>
          <div class="org-actions">
            <button type="button"
              onclick="editModelEntitlement('${esc(id(e))}')">
              Edit
            </button>
            <button type="button" class="danger"
              onclick="deleteModelEntitlement('${esc(id(e))}')">
              Delete
            </button>
          </div>
        </div>
      `).join('') || '<div class="org-row muted">No entitlement rules for this institution.</div>';
    }

    const experienceClasses = [
      {
        id:'CLASS_A',
        label:'Class A — Advanced Academic',
        providerKey:'ais-free-router',
        model:'class-a'
      },
      {
        id:'CLASS_B',
        label:'Class B — General Academic',
        providerKey:'ais-free-router',
        model:'class-b'
      },
      {
        id:'CLASS_C_GENERAL',
        label:'Class C — Premium General',
        providerKey:'azure-undergraduate',
        model:'gpt-4.1-mini'
      },
      {
        id:'CLASS_C_ADVANCED',
        label:'Class C — Premium Advanced',
        providerKey:'azure-research',
        model:'gpt-5.4-mini'
      }
    ];

    const primaryExperiences = [
      {
        experienceId:'EXPERIENCE_K12',
        name:'K–12 Socratic Tutor',
        modelSpecName:'K-12 Socratic Tutor',
        defaultClass:'CLASS_B'
      },
      {
        experienceId:'EXPERIENCE_UNDERGRADUATE',
        name:'Undergraduate Socratic Tutor',
        modelSpecName:'Undergrad Socratic Tutor',
        defaultClass:'CLASS_B'
      },
      {
        experienceId:'EXPERIENCE_RESEARCH',
        name:'PhD/Post-Doc Research Synthesizer',
        modelSpecName:'PhD & Post-Doc Research',
        defaultClass:'CLASS_A'
      }
    ];

    function classForRoute(route) {
      return experienceClasses.find(item =>
        item.providerKey === route?.providerKey &&
        item.model === route?.model
      );
    }

    function experienceClassRows() {
      return experienceClasses.map(item => {
        const configured = state.models.find(model =>
          model.providerKey === item.providerKey && model.model === item.model
        );
        return `
          <div class="org-row">
            <div>
              <b>${esc(item.label)}</b>
              <div class="org-small">
                Managed experience route
              </div>
            </div>
            <span class="org-tag ${configured?.enabled !== false && configured ? 'org-enabled' : 'org-disabled'}">
              ${configured?.enabled !== false && configured ? 'Enabled' : 'Unavailable'}
            </span>
          </div>
        `;
      }).join('');
    }

    function primaryRoute(experience) {
      return state.personaRoutes.find(item =>
        item.personaId === experience.experienceId &&
        item.routeId === 'EXPERIENCE_CLASS'
      );
    }

    function primaryExperienceRows() {
      return primaryExperiences.map(experience => {
        const route = primaryRoute(experience);
        const experienceClass = classForRoute(route);
        const policyRef = route
          ? `${route.providerKey}:${route.model}`
          : '';
        const relevant = state.entitlements.filter(item =>
          item.enabled !== false && item.agentId === '*'
        );
        const entitled = relevant
          .filter(item => (item.allowedModels || []).includes(policyRef))
          .map(item => item.role);
        const notEntitled = relevant
          .filter(item => !(item.allowedModels || []).includes(policyRef))
          .map(item => item.role);
        return `
          <div class="org-row">
            <div>
              <b>${esc(experience.name)}</b>
              <div class="org-small">
                ${esc(experience.modelSpecName)} •
                ${esc(experienceClass?.label || 'No class assigned')}
              </div>
              <div class="org-small">
                Institution experience route; access remains constrained by role entitlements.
              </div>
              ${route ? `
                <div class="org-small" style="margin-top:5px">
                  Available to: ${esc(entitled.join(', ') || 'No configured role')}
                </div>
                ${notEntitled.length ? `
                  <div class="org-small" style="color:#9a5b00">
                    Not entitled: ${esc(notEntitled.join(', '))}
                  </div>
                ` : ''}
              ` : ''}
            </div>
            <div class="org-actions">
              <button type="button"
                onclick="openExperienceClassForm('${esc(experience.experienceId)}')">
                ${route ? 'Change Class' : 'Assign Class'}
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    function academicAgentRows() {
      return state.agents.map(agent => {
        const experience = primaryExperiences.find(item =>
          item.modelSpecName === agent.modelSpecName
        );
        const route = experience ? primaryRoute(experience) : null;
        const experienceClass = classForRoute(route);
        return `
          <div class="org-row">
            <div>
              <b>${esc(agent.name || agent.agentId)}</b>
              <div class="org-small">
                ${esc(experience?.name || agent.modelSpecName || 'Unassociated')} •
                ${experienceClass
                  ? `Inherits ${esc(experienceClass.label)}`
                  : 'Awaiting primary experience assignment'}
              </div>
            </div>
            <div class="org-actions">
              <span class="org-tag ${experienceClass ? 'org-enabled' : 'org-disabled'}">
                ${experienceClass ? 'Inherited' : 'Unassigned'}
              </span>
              <button type="button" onclick="showAdminTab('agents')">
                Edit Agent Policy
              </button>
            </div>
          </div>
        `;
      }).join('') || '<div class="org-row muted">No Academic Agents configured for this institution.</div>';
    }

    function classCompositionRows() {
      return state.classComposition.map(group => `
        <div class="org-row" style="display:block">
          <b>${esc(group.label)}</b>
          <div style="margin-top:6px">
            ${(group.routes || []).map(route => {
              const validation = state.routeValidation.find(item =>
                item.provider === String(route.provider || '').toLowerCase() &&
                item.model === route.model
              );
              return `
              <div class="org-small" style="margin:4px 0">
                ${esc(route.provider)} • ${esc(route.model)}
                <span class="org-tag">${esc(route.mode)}</span>
                ${validation ? `
                  <span class="org-tag ${validation.available ? 'org-enabled' : 'org-disabled'}">
                    ${esc(validation.category)}
                  </span>
                ` : ''}
              </div>
            `;}).join('')}
          </div>
        </div>
      `).join('') || '<div class="org-row muted">No class composition configured.</div>';
    }

    function render() {
      host.className = '';

      host.innerHTML = `
        <div class="panel">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <div>
              <h2>AI Experience Policy</h2>
              <div class="muted">
                Control which AI models are available by institution and role.
              </div>
            </div>

            <select id="modelPolicyTenant">
              <option value="">Select institution...</option>
              ${state.institutions.map(i => `
                <option value="${esc(i._id)}"
                  ${String(i._id) === state.tenantId ? 'selected' : ''}>
                  ${esc(i.name || i._id)}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="org-grid" style="margin-top:14px">

            <div class="org-card">
              <h3>Experience Classes</h3>
              <div class="muted">
                Stable policy choices used for entitlements and experience routing.
              </div>
              <div class="org-list">${experienceClassRows()}</div>
            </div>

            <div class="org-card">
              <h3>Class Composition</h3>
              <div class="muted">
                Restricted operational inventory. Credentials and account identifiers are never displayed.
              </div>
              <div class="org-toolbar">
                <button type="button" onclick="validateModelRoutes()">
                  Check Model Availability
                </button>
                ${state.validatedAt ? `
                  <span class="org-small">
                    Last checked ${esc(new Date(state.validatedAt * 1000).toLocaleString())}
                  </span>
                ` : ''}
              </div>
              <div class="org-list">${classCompositionRows()}</div>
            </div>

            <div class="org-card">
              <h3>Tenant + Role Entitlements</h3>
              <div class="muted">
                Define allowed, default and fallback models for each role.
              </div>
              <div class="org-toolbar">
                <button class="primary" type="button"
                  ${state.tenantId ? '' : 'disabled'}
                  onclick="openModelEntitlementForm()">+ Entitlement</button>
              </div>
              <div class="org-list">${entitlementRows()}</div>
            </div>

            <div class="org-card">
              <h3>Primary Experience Routing</h3>
              <div class="muted">
                Configure exactly three institution-level educational experiences.
                The selected class must also be allowed by its entitlement.
              </div>
              <div class="org-list">${primaryExperienceRows()}</div>
            </div>

            <div class="org-card">
              <h3>Academic Agent Routing</h3>
              <div class="muted">
                Specialized agents inherit the class of their associated primary experience.
              </div>
              <div class="org-list">${academicAgentRows()}</div>
            </div>

          </div>
        </div>
      `;

      const tenant = document.getElementById('modelPolicyTenant');

      tenant.onchange = async () => {
        state.tenantId = tenant.value;
        await load();
      };
    }

    function popup(title, body, save) {
      const old = document.getElementById('modelPolicyDialog');
      if (old) old.remove();

      const d = document.createElement('dialog');
      d.id = 'modelPolicyDialog';

      d.innerHTML = `
        <form class="org-form-grid">
          <h3>${esc(title)}</h3>
          ${body}
          <div style="display:flex;gap:8px">
            <button class="primary">Save</button>
            <button type="button"
              onclick="this.closest('dialog').close()">Cancel</button>
          </div>
        </form>
      `;

      document.body.appendChild(d);

      d.querySelector('form').onsubmit = async e => {
        e.preventDefault();

        try {
          await save(d.querySelector('form'));
          d.close();
          await load();
        } catch (err) {
          alert(err.message);
        }
      };

      d.addEventListener('close', () => d.remove(), { once:true });
      d.showModal();
    }

    window.openProviderPolicyForm = () => {
      popup(
        'Add AI Provider',
        `
          <input name="key" required placeholder="Provider key, e.g. ollama">
          <input name="name" required placeholder="Display name">
          <input name="endpointType" value="custom" placeholder="Endpoint type">

          <select name="costTier">
            <option>ECONOMY</option>
            <option selected>BALANCED</option>
            <option>ADVANCED</option>
          </select>

          <textarea name="description"
            placeholder="Description"></textarea>
        `,
        async f => call('/api/ai-providers', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            key:f.key.value,
            name:f.name.value,
            endpointType:f.endpointType.value,
            costTier:f.costTier.value,
            description:f.description.value
          })
        })
      );
    };

    window.validateModelRoutes = async () => {
      try {
        const data = await call('/api/ai-policy/validate-routes', {
          method:'POST'
        });
        state.routeValidation = data.results || [];
        state.validatedAt = data.validatedAt || null;
        render();
      } catch (e) {
        alert(e.message);
      }
    };

    window.openExperienceClassForm = experienceId => {
      if (!state.tenantId)
        return alert('Select an institution first.');

      const experience = primaryExperiences.find(
        item => item.experienceId === experienceId
      );
      if (!experience) return;

      const existing = primaryRoute(experience);
      const selected = classForRoute(existing)?.id || '';

      popup(
        `Assign Experience Class — ${experience.name}`,
        `
          <label class="muted">Experience class</label>
          <select name="experienceClass" required>
            <option value="">Select a class...</option>
            ${experienceClasses.map(item => `
              <option value="${esc(item.id)}"
                ${selected === item.id ? 'selected' : ''}>
                ${esc(item.label)}
              </option>
            `).join('')}
          </select>

          <div class="muted">
            This controls routing only. It never grants access beyond the
            institution and role entitlement policy.
          </div>
        `,
        async f => {
          const choice = experienceClasses.find(
            item => item.id === f.experienceClass.value
          );
          if (!choice) throw new Error('Select a valid experience class.');

          const body = {
            tenantId:state.tenantId,
            personaId:experience.experienceId,
            routeId:'EXPERIENCE_CLASS',
            modelSpecName:experience.modelSpecName,
            providerKey:choice.providerKey,
            model:choice.model,
            priority:200,
            enabled:true,
            description:`Primary experience ${experience.name}: ${choice.label}`
          };

          await call(
            existing
              ? `/api/persona-model-routes/${encodeURIComponent(existing._id)}`
              : '/api/persona-model-routes',
            {
              method:existing ? 'PATCH' : 'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify(body)
            }
          );
        }
      );
    };

    window.openModelPolicyForm = () => {
      if (!state.providers.length)
        return alert('Create a provider first.');

      popup(
        'Add AI Model',
        `
          <select name="providerKey" required>
            ${state.providers
              .filter(p => p.enabled !== false)
              .map(p => `
                <option value="${esc(p.key)}">
                  ${esc(p.name)}
                </option>
              `).join('')}
          </select>

          <input name="model" required
            placeholder="Model identifier">

          <input name="label"
            placeholder="Friendly label">

          <select name="costTier">
            <option>ECONOMY</option>
            <option selected>BALANCED</option>
            <option>ADVANCED</option>
          </select>

          <input name="contextWindow"
            type="number"
            min="1"
            placeholder="Context window (optional)">

          <textarea name="description"
            placeholder="Description"></textarea>
        `,
        async f => call('/api/ai-models', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            providerKey:f.providerKey.value,
            model:f.model.value,
            label:f.label.value,
            costTier:f.costTier.value,
            contextWindow:f.contextWindow.value || null,
            description:f.description.value
          })
        })
      );
    };

    window.openModelEntitlementForm = (existing=null) => {
      if (!state.tenantId)
        return alert('Select an institution first.');

      popup(
        existing ? 'Edit Model Entitlement' : 'Add Model Entitlement',
        `
          <select name="role">
            ${['USER','INSTRUCTOR','INSTITUTION_ADMIN','PLATFORM_ADMIN','SUPERADMIN']
              .map(r => `
                <option value="${r}"
                  ${existing?.role === r ? 'selected' : ''}>
                  ${r}
                </option>
              `).join('')}
          </select>

          <label class="muted">Academic Agent scope</label>
          <select name="agentId">
            <option value="*"
              ${!existing?.agentId || existing?.agentId === '*' ? 'selected' : ''}>
              All Academic Agents (*)
            </option>

            <option value="SOCRATIC_TUTOR"
              ${existing?.agentId === 'SOCRATIC_TUTOR' ? 'selected' : ''}>
              Socratic Tutor
            </option>

            <option value="RESEARCH_SYNTHESIZER"
              ${existing?.agentId === 'RESEARCH_SYNTHESIZER' ? 'selected' : ''}>
              Research Synthesizer
            </option>
          </select>

          <div class="muted" style="font-size:12px">
            "*" is the default policy for all Academic Agents.
            Agent-specific rules may override it.
          </div>

          <label class="muted">Cost tier</label>
          <select name="costTier">
            ${['ECONOMY','BALANCED','ADVANCED']
              .map(t => `
                <option
                  ${existing?.costTier === t ? 'selected' :
                    (!existing && t === 'BALANCED' ? 'selected' : '')}>
                  ${t}
                </option>
              `).join('')}
          </select>

          <label class="muted">Allowed models</label>

          <div style="
            border:1px solid #ddd;
            border-radius:6px;
            padding:10px;
            max-height:220px;
            overflow:auto">

            ${state.models
              .filter(m => m.enabled !== false && m.managed === true)
              .map(m => {
                const key = modelKey(m);
                const checked =
                  (existing?.allowedModels || []).includes(key);

                return `
                  <label style="
                    display:flex;
                    gap:8px;
                    align-items:center;
                    margin:5px 0">

                    <input
                      type="checkbox"
                      name="allowedModels"
                      value="${esc(key)}"
                      ${checked ? 'checked' : ''}>

                    <span>
                      ${esc(m.label || m.model)}
                      [${esc(m.costTier || 'BALANCED')}]
                    </span>
                  </label>
                `;
              }).join('') || '<div class="muted">No models configured.</div>'}
          </div>

          <label class="muted">Default model</label>
          <select name="defaultModel">
            <option value="">None</option>
            ${state.models
              .filter(m => m.enabled !== false && m.managed === true)
              .map(m => {
                const key=modelKey(m);
                return `<option value="${esc(key)}"
                  ${existing?.defaultModel === key ? 'selected' : ''}>
                  ${esc(m.label || m.model)}
                </option>`;
              }).join('')}
          </select>

          <label class="muted">Fallback models</label>

          <div style="
            border:1px solid #ddd;
            border-radius:6px;
            padding:10px;
            max-height:180px;
            overflow:auto">

            ${state.models
              .filter(m => m.enabled !== false && m.managed === true)
              .map(m => {
                const key = modelKey(m);
                const checked =
                  (existing?.fallbackModels || []).includes(key);

                return `
                  <label style="
                    display:flex;
                    gap:8px;
                    align-items:center;
                    margin:5px 0">

                    <input
                      type="checkbox"
                      name="fallbackModels"
                      value="${esc(key)}"
                      ${checked ? 'checked' : ''}>

                    <span>
                      ${esc(m.label || m.model)}
                    </span>
                  </label>
                `;
              }).join('')}
          </div>
        `,
        async f => {
          const values = field =>
            [...f.querySelectorAll(
              `input[name="${field}"]:checked`
            )].map(el => el.value);

          await call('/api/model-entitlements', {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
              tenantId:state.tenantId,
              role:f.role.value,
              agentId:f.agentId.value || '*',
              costTier:f.costTier.value,
              allowedModels:values('allowedModels'),
              defaultModel:f.defaultModel.value || null,
              fallbackModels:values('fallbackModels'),
              enabled:true
            })
          });
        }
      );
    };

    window.editModelEntitlement = entitlementId => {
      const e = state.entitlements.find(x => id(x) === entitlementId);
      if (e) openModelEntitlementForm(e);
    };

    window.deleteModelEntitlement = async entitlementId => {
      if (!confirm('Delete this model entitlement rule?')) return;

      try {
        await call(
          `/api/model-entitlements/${encodeURIComponent(entitlementId)}`,
          { method:'DELETE' }
        );
        await load();
      } catch (e) {
        alert(e.message);
      }
    };

    async function load() {
      const q = state.tenantId
        ? `?tenantId=${encodeURIComponent(state.tenantId)}`
        : '';

      const data = await call(`/api/ai-policy/catalog${q}`);

      state.providers = data.providers || [];
      state.models = data.models || [];
      state.entitlements = data.entitlements || [];
      state.agents = data.agents || [];
      state.personaRoutes = data.personaRoutes || [];
      state.classComposition = data.classComposition || [];
      state.institutions = data.institutions || [];

      if (
        state.tenantId &&
        !state.institutions.some(i => String(i._id) === state.tenantId)
      ) {
        state.tenantId = '';
      }

      render();
    }

    load().catch(e => {
      host.innerHTML = `
        <div class="admin-placeholder">
          <h2>AI Experience Policy</h2>
          <div style="color:#a00">${esc(e.message)}</div>
        </div>
      `;
    });
  };

  boot();
})();
