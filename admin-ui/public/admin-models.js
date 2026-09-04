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

    function modelOptions(selected=[]) {
      const chosen = new Set((selected || []).map(String));

      return state.models
        .filter(m => m.enabled !== false)
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
              Default: ${esc(e.defaultModel || 'None')}
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

    function render() {
      host.className = '';

      host.innerHTML = `
        <div class="panel">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <div>
              <h2>AI Models & Providers</h2>
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
              <h3>Providers</h3>
              <div class="muted">
                Catalog only. Credentials remain server-side and are never shown here.
              </div>
              <div class="org-toolbar">
                <button class="primary" type="button"
                  onclick="openProviderPolicyForm()">+ Provider</button>
              </div>
              <div class="org-list">${providerRows()}</div>
            </div>

            <div class="org-card">
              <h3>Models</h3>
              <div class="muted">
                Register approved models and classify their cost tier.
              </div>
              <div class="org-toolbar">
                <button class="primary" type="button"
                  onclick="openModelPolicyForm()">+ Model</button>
              </div>
              <div class="org-list">${modelRows()}</div>
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
            ${['USER','INSTRUCTOR','INSTITUTION_ADMIN','PLATFORM_ADMIN']
              .map(r => `
                <option value="${r}"
                  ${existing?.role === r ? 'selected' : ''}>
                  ${r}
                </option>
              `).join('')}
          </select>

          <input name="agentId"
            value="${esc(existing?.agentId || '*')}"
            placeholder="Academic Agent ID or *">

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
          <select name="allowedModels" multiple>
            ${modelOptions(existing?.allowedModels || [])}
          </select>

          <label class="muted">Default model</label>
          <select name="defaultModel">
            <option value="">None</option>
            ${state.models
              .filter(m => m.enabled !== false)
              .map(m => {
                const key=modelKey(m);
                return `<option value="${esc(key)}"
                  ${existing?.defaultModel === key ? 'selected' : ''}>
                  ${esc(m.label || m.model)} — ${esc(m.providerKey)}
                </option>`;
              }).join('')}
          </select>

          <label class="muted">Fallback models</label>
          <select name="fallbackModels" multiple>
            ${modelOptions(existing?.fallbackModels || [])}
          </select>
        `,
        async f => {
          const values = field => {
            const el = f.querySelector(`[name="${field}"]`);
            return el
              ? [...el.selectedOptions].map(o => o.value)
              : [];
          };

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
          <h2>AI Models & Providers</h2>
          <div style="color:#a00">${esc(e.message)}</div>
        </div>
      `;
    });
  };

  boot();
})();
