/* AI Scholar Hub Admin UI — Organization + RAG administration */
(() => {
  const boot = () => {
    if (typeof currentMe === 'undefined' || !currentMe) return setTimeout(boot, 250);
    if (!['INSTITUTION_ADMIN','PLATFORM_ADMIN','SUPERADMIN','ADMIN'].includes(String(currentMe.role || '').toUpperCase())) return;
    if (document.getElementById('organizationPanel')) return;

    const style = document.createElement('style');
    style.textContent = `
      .org-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
      .org-card{border:1px solid #ddd;border-radius:8px;background:#fafafa;padding:14px}
      .org-card h3{margin:0 0 6px;font-size:16px}
      .org-card .org-list{max-height:300px;overflow:auto;border:1px solid #e1e1e1;background:#fff;border-radius:6px;margin-top:10px}
      .org-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 10px;border-bottom:1px solid #eee}
      .org-row:last-child{border-bottom:0}
      .org-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
      .org-small{font-size:12px;color:#666}
      .org-tag{display:inline-block;padding:3px 7px;border-radius:999px;background:#eef0f3;font-size:11px;font-weight:600;margin:2px}
      .org-enabled{background:#e6f5ea;color:#176b2c}
      .org-disabled{background:#fce8e8;color:#9b1c1c}
      .org-toolbar{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
      .org-form-grid{display:grid;gap:10px;min-width:420px}
      .org-form-grid textarea{min-height:80px;resize:vertical}
      .org-form-grid select[multiple]{min-height:150px}
      @media(max-width:700px){.org-form-grid{min-width:280px}}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'organizationPanel';
    panel.className = 'panel';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div><h2>Organization & RAG Access</h2><div class="muted" id="orgScopeText"></div></div>
        <button type="button" onclick="loadOrganizationAdmin()">Refresh</button>
      </div>
      <div class="org-grid" style="margin-top:12px">
        <div class="org-card">
          <h3>Departments / Schools</h3>
          <div class="muted">Create and maintain institution departments or schools.</div>
          <div class="org-toolbar"><button type="button" class="primary" onclick="openDepartmentForm()">+ Department</button></div>
          <div id="departmentList" class="org-list"></div>
        </div>
        <div class="org-card">
          <h3>Courses / Classes</h3>
          <div class="muted">Create courses/classes and associate them with departments.</div>
          <div class="org-toolbar"><button type="button" class="primary" onclick="openCourseForm()">+ Course</button></div>
          <div id="courseList" class="org-list"></div>
        </div>
        <div class="org-card">
          <h3>Groups</h3>
          <div class="muted">Create groups and manage users, departments and courses assigned to each group.</div>
          <div class="org-toolbar"><button type="button" class="primary" onclick="openGroupForm()">+ Group</button></div>
          <div id="groupList" class="org-list"></div>
        </div>
        <div class="org-card">
          <h3>RAG Access Points</h3>
          <div class="muted">Institution and personal scopes are automatic. Configure department, course and instructor scopes here.</div>
          <div class="org-toolbar"><button type="button" class="primary" onclick="openRagForm()">+ RAG Access Point</button></div>
          <div id="ragLocationList" class="org-list"></div>
        </div>
        <div class="org-card">
          <h3>RAG Groups</h3>
          <div class="muted">Create knowledge and security boundaries and associate them with organizational groups.</div>
          <div class="org-toolbar"><button type="button" class="primary" onclick="openRagGroupForm()">+ RAG Group</button></div>
          <div id="ragGroupList" class="org-list"></div>
        </div>
      </div>`;

    const main = document.querySelector('main');
    const toolbar = main?.querySelector('.toolbar');
    if (toolbar) main.insertBefore(panel, toolbar);
    else main?.prepend(panel);

    const state = { departments: [], courses: [], groups: [], rag: [], ragGroups: [], users: [] };
    const esc2 = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
    const id = x => String(x?._id || x?.id || '');
    const arg = x => encodeURIComponent(JSON.stringify(x));
    const scope = () => String(currentMe?.tenantId || '').trim();
    const canDelete = () => true;

    function dialog(title, body, onSubmit){
      const d=document.createElement('dialog'); d.id='orgDynamicDialog';
      d.innerHTML=`<form method="dialog" class="org-form-grid"><h3>${esc2(title)}</h3>${body}<div style="display:flex;gap:8px"><button class="primary">Save</button><button type="button" onclick="this.closest('dialog').close()">Cancel</button></div></form>`;
      document.body.appendChild(d);
      d.querySelector('form').addEventListener('submit', async e=>{e.preventDefault();try{await onSubmit(d);d.close();await loadOrganizationAdmin()}catch(err){alert(err.message)}});
      d.addEventListener('close',()=>d.remove(),{once:true}); d.showModal(); return d;
    }

    function options(items, selected=[]){return items.map(x=>`<option value="${esc2(id(x))}" ${selected.map(String).includes(id(x))?'selected':''}>${esc2(x.name||x.email||x.code||id(x))}</option>`).join('')}

    window.openDepartmentForm = function(existing=null){
      dialog(existing?'Edit Department':'Create Department',
        `<input name="name" required maxlength="200" placeholder="Department / School name" value="${esc2(existing?.name||'')}">
         <input name="code" maxlength="100" placeholder="Code (optional)" value="${esc2(existing?.code||'')}">
         <textarea name="description" maxlength="1000" placeholder="Description (optional)">${esc2(existing?.description||'')}</textarea>`,
        async d=>{const f=d.querySelector('form');await api(existing?`/api/departments/${encodeURIComponent(id(existing))}`:'/api/departments',{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name.value,code:f.code.value,description:f.description.value})})});
    };

    window.openCourseForm = function(existing=null){
      dialog(existing?'Edit Course':'Create Course',
        `<input name="name" required maxlength="200" placeholder="Course / Class name" value="${esc2(existing?.name||'')}">
         <input name="code" maxlength="100" placeholder="Course code (optional)" value="${esc2(existing?.code||'')}">
         <select name="departmentId"><option value="">No department</option>${options(state.departments,existing?.departmentId?[existing.departmentId]:[])}</select>
         <textarea name="description" maxlength="1000" placeholder="Description (optional)">${esc2(existing?.description||'')}</textarea>`,
        async d=>{const f=d.querySelector('form');await api(existing?`/api/courses/${encodeURIComponent(id(existing))}`:'/api/courses',{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name.value,code:f.code.value,departmentId:f.departmentId.value||null,description:f.description.value})})});
    };

    function groupChildren(excludeId=''){
      return state.groups
        .filter(g=>id(g)!==String(excludeId))
        .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    }

    function groupLabel(g){
      const parent=state.groups.find(x=>id(x)===String(g.parentGroupId||''));
      return parent ? `${parent.name} / ${g.name}` : g.name;
    }

    window.openGroupForm = function(existing=null){
      const selectedMembers=existing?.memberIds||[];
      const selectedDepartments=existing?.departmentIds||[];
      const selectedCourses=existing?.courseIds||[];
      const selectedParent=existing?.parentGroupId ? [existing.parentGroupId] : [];

      dialog(existing?'Edit Group':'Create Group',
        `<input name="name" required maxlength="200" placeholder="Group / Subgroup name" value="${esc2(existing?.name||'')}">
         <textarea name="description" maxlength="1000" placeholder="Description (optional)">${esc2(existing?.description||'')}</textarea>
         <label class="muted">Parent Group (optional)</label>
         <select name="parentGroupId"><option value="">Top-level group</option>${options(groupChildren(id(existing)),selectedParent)}</select>
         <label class="muted">Members (users/instructors)</label>
         <select name="memberIds" multiple>${options(state.users,selectedMembers)}</select>
         <label class="muted">Departments / Schools</label>
         <select name="departmentIds" multiple>${options(state.departments,selectedDepartments)}</select>
         <label class="muted">Courses / Classes</label>
         <select name="courseIds" multiple>${options(state.courses,selectedCourses)}</select>`,
        async d=>{
          const f=d.querySelector('form');
          const vals=n=>[...f[n].selectedOptions].map(o=>o.value);
          await api(
            existing?`/api/groups/${encodeURIComponent(id(existing))}`:'/api/groups',
            {
              method:existing?'PATCH':'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({
                name:f.name.value,
                description:f.description.value,
                parentGroupId:f.parentGroupId.value||null,
                memberIds:vals('memberIds'),
                departmentIds:vals('departmentIds'),
                courseIds:vals('courseIds')
              })
            }
          );
        }
      );
    };

    window.openGroupAdmins = async function(encoded){
      const item = typeof encoded === 'string'
        ? JSON.parse(decodeURIComponent(encoded))
        : encoded;

      const groupId = id(item);
      const eligibleRoles = 'USER,Instructor,INSTITUTION_ADMIN';

      try{
        const result = await api(`/api/groups/${encodeURIComponent(groupId)}/admins`);
        const current = result.admins || [];

        const selected = new Map(
          current.map(a=>[
            String(a.userId),
            new Set(Array.isArray(a.permissions)?a.permissions:[])
          ])
        );

        const renderUser = u => {
          const uid = id(u);
          const perms = selected.get(uid) || new Set([
            'MANAGE_MEMBERS',
            'MANAGE_SUBGROUPS',
            'MANAGE_RAG'
          ]);

          return `<div class="org-row" data-admin-user="${esc2(uid)}"
                    style="display:block;margin-bottom:8px">
            <label style="display:flex;gap:8px;align-items:center">
              <input type="checkbox" name="adminUser"
                     value="${esc2(uid)}"
                     ${selected.has(uid)?'checked':''}>
              <strong>${esc2(u.name||u.username||u.email)}</strong>
              <span class="org-tag">${esc2(u.role)}</span>
            </label>

            <div style="margin:6px 0 0 26px;display:flex;gap:12px;flex-wrap:wrap">
              <label>
                <input type="checkbox"
                       data-perm="${esc2(uid)}"
                       value="MANAGE_MEMBERS"
                       ${perms.has('MANAGE_MEMBERS')?'checked':''}>
                Members
              </label>

              <label>
                <input type="checkbox"
                       data-perm="${esc2(uid)}"
                       value="MANAGE_SUBGROUPS"
                       ${perms.has('MANAGE_SUBGROUPS')?'checked':''}>
                Subgroups
              </label>

              <label>
                <input type="checkbox"
                       data-perm="${esc2(uid)}"
                       value="MANAGE_RAG"
                       ${perms.has('MANAGE_RAG')?'checked':''}>
                RAG
              </label>

              <label>
                <input type="checkbox"
                       data-perm="${esc2(uid)}"
                       value="MANAGE_ADMINS"
                       ${perms.has('MANAGE_ADMINS')?'checked':''}>
                Admins
              </label>
            </div>
          </div>`;
        };

        const currentHtml = current.map(a => a.user ? renderUser(a.user) : '').join('');

        dialog(
          `Group Administrators — ${item.name}`,

          `<div class="muted">
             Assign users or instructors and select their scoped permissions.
           </div>

           <input name="adminSearch"
                  autocomplete="off"
                  placeholder="Search name, username, or email"
                  style="width:100%;margin-top:10px">

           <div class="muted" style="margin-top:6px">
             Enter at least 2 characters. Up to 25 matching users are shown.
           </div>

           <div id="groupAdminSearchResults"
                style="max-height:260px;overflow:auto;margin-top:10px"></div>

           <div class="muted" style="margin-top:12px">
             Current administrators
           </div>

           <div id="groupAdminCurrent"
                style="max-height:260px;overflow:auto;margin-top:6px">
             ${currentHtml || '<div class="muted">No administrators assigned.</div>'}
           </div>`,

          async d=>{
            const admins=[...d.querySelectorAll('input[name="adminUser"]:checked')].map(cb=>{
              const uid=cb.value;

              return {
                userId:uid,
                permissions:[
                  ...d.querySelectorAll(
                    `input[data-perm="${uid}"]:checked`
                  )
                ].map(x=>x.value)
              };
            });

            await api(`/api/groups/${encodeURIComponent(groupId)}/admins`,{
              method:'PUT',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({admins})
            });
          }
        );

        const searchInput = document.querySelector('input[name="adminSearch"]');
        const resultsBox = document.getElementById('groupAdminSearchResults');

        if (!searchInput || !resultsBox) return;

        let timer = null;
        let requestNo = 0;

        const doSearch = async () => {
          const q = searchInput.value.trim();

          if (q.length < 2) {
            resultsBox.innerHTML =
              '<div class="muted">Enter at least 2 characters to search.</div>';
            return;
          }

          const requestId = ++requestNo;
          resultsBox.innerHTML = '<div class="muted">Searching...</div>';

          try {
            const found = await api(
              `/api/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(eligibleRoles)}&limit=25`
            );

            if (requestId !== requestNo) return;

            const matches = Array.isArray(found) ? found : [];

            resultsBox.innerHTML = matches.length
              ? matches.map(renderUser).join('')
              : '<div class="muted">No matching users.</div>';

          } catch(e) {
            if (requestId === requestNo) {
              resultsBox.innerHTML =
                `<div class="muted">${esc2(e.message||'Search failed')}</div>`;
            }
          }
        };

        searchInput.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(doSearch, 250);
        });

      }catch(e){
        alert(e.message);
      }
    };

    window.openRagForm = function(existing=null){
      const type=existing?.type||'DEPARTMENT';
      let targets=type==='DEPARTMENT'?state.departments:type==='COURSE'?state.courses:state.users.filter(u=>String(u.role||'').toUpperCase()==='INSTRUCTOR');
      const selected=existing?.targetId||'';
      dialog(existing?'Edit RAG Access Point':'Create RAG Access Point',
        `<select name="type" ${existing?'disabled':''}><option value="DEPARTMENT" ${type==='DEPARTMENT'?'selected':''}>Department / School</option><option value="COURSE" ${type==='COURSE'?'selected':''}>Course / Class</option><option value="INSTRUCTOR" ${type==='INSTRUCTOR'?'selected':''}>Instructor</option></select>
         <select name="targetId" ${existing?'disabled':''} required>${options(targets,selected?[selected]:[])}</select>
         <input name="name" maxlength="200" placeholder="Display name (optional)" value="${esc2(existing?.name||'')}">
         <textarea name="description" maxlength="1000" placeholder="Description (optional)">${esc2(existing?.description||'')}</textarea>
         <label><input type="checkbox" name="enabled" ${existing?.enabled!==false?'checked':''}> Enabled</label>`,
        async d=>{const f=d.querySelector('form');if(existing){await api(`/api/rag-locations/${encodeURIComponent(id(existing))}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name.value,description:f.description.value,enabled:f.enabled.checked})})}else{await api('/api/rag-locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:f.type.value,targetId:f.targetId.value,name:f.name.value,description:f.description.value,enabled:f.enabled.checked})})}});
    };



    window.openRagGroupManagers = async function(encoded){
      const item = typeof encoded === 'string'
        ? JSON.parse(decodeURIComponent(encoded))
        : encoded;

      const ragGroupId = id(item);
      const eligibleRoles = 'Instructor,INSTITUTION_ADMIN';

      try{
        const result = await api(
          `/api/rag-groups/${encodeURIComponent(ragGroupId)}/managers`
        );
        const current = result.managers || [];

        const selected = new Map(
          current.map(m => [
            String(m.userId),
            new Set(Array.isArray(m.permissions) ? m.permissions : [])
          ])
        );

        const renderUser = u => {
          const uid = id(u);
          const perms = selected.get(uid) || new Set([
            'MANAGE_DOCUMENTS',
            'MANAGE_ACCESS'
          ]);

          return `<div class="org-row" style="display:block;margin-bottom:8px">
            <label style="display:flex;gap:8px;align-items:center">
              <input type="checkbox" name="ragManagerUser"
                     value="${esc2(uid)}"
                     ${selected.has(uid)?'checked':''}>
              <strong>${esc2(u.name||u.username||u.email)}</strong>
              <span class="org-tag">${esc2(u.role)}</span>
            </label>

            <div style="margin:6px 0 0 26px;display:flex;gap:12px;flex-wrap:wrap">
              <label>
                <input type="checkbox"
                       data-rag-perm="${esc2(uid)}"
                       value="MANAGE_DOCUMENTS"
                       ${perms.has('MANAGE_DOCUMENTS')?'checked':''}>
                Documents
              </label>

              <label>
                <input type="checkbox"
                       data-rag-perm="${esc2(uid)}"
                       value="MANAGE_ACCESS"
                       ${perms.has('MANAGE_ACCESS')?'checked':''}>
                Access
              </label>
            </div>
          </div>`;
        };

        const currentHtml = current
          .map(m => m.user ? renderUser(m.user) : '')
          .join('');

        dialog(
          `RAG Group Managers — ${item.name}`,
          `<div class="muted">
             Search for Instructors or Institution Admins to manage this RAG Group.
           </div>

           <input name="ragManagerSearch"
                  placeholder="Search name, username, or email"
                  autocomplete="off">

           <div id="ragManagerSearchResults"
                style="max-height:260px;overflow:auto;margin-top:10px"></div>

           <div class="muted" style="margin-top:12px">
             Current managers
           </div>

           <div id="ragManagerCurrent"
                style="max-height:260px;overflow:auto;margin-top:6px">
             ${currentHtml || '<div class="muted">No managers assigned.</div>'}
           </div>`,

          async d=>{
            const managers=[
              ...d.querySelectorAll('input[name="ragManagerUser"]:checked')
            ].map(cb=>{
              const uid=cb.value;

              return {
                userId:uid,
                permissions:[
                  ...d.querySelectorAll(
                    `input[data-rag-perm="${uid}"]:checked`
                  )
                ].map(x=>x.value)
              };
            });

            await api(
              `/api/rag-groups/${encodeURIComponent(ragGroupId)}/managers`,
              {
                method:'PUT',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({managers})
              }
            );
          }
        );

        const searchInput =
          document.querySelector('input[name="ragManagerSearch"]');
        const resultsBox =
          document.getElementById('ragManagerSearchResults');

        if (!searchInput || !resultsBox) return;

        let timer=null;
        let requestNo=0;

        const doSearch=async()=>{
          const q=searchInput.value.trim();

          if(q.length<2){
            resultsBox.innerHTML=
              '<div class="muted">Enter at least 2 characters to search.</div>';
            return;
          }

          const requestId=++requestNo;
          resultsBox.innerHTML='<div class="muted">Searching...</div>';

          try{
            const found=await api(
              `/api/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(eligibleRoles)}&limit=25`
            );

            if(requestId!==requestNo)return;

            const matches=Array.isArray(found)?found:[];

            resultsBox.innerHTML=matches.length
              ? matches.map(renderUser).join('')
              : '<div class="muted">No matching users.</div>';
          }catch(e){
            if(requestId===requestNo){
              resultsBox.innerHTML=
                `<div class="muted">${esc2(e.message||'Search failed')}</div>`;
            }
          }
        };

        searchInput.addEventListener('input',()=>{
          clearTimeout(timer);
          timer=setTimeout(doSearch,250);
        });

      }catch(e){
        alert(e.message);
      }
    };

    window.openRagGroupForm = function(existing=null){
      const selectedGroups=existing?.groupIds||[];
      const selectedDepartments=existing?.departmentIds||[];
      const selectedCourses=existing?.courseIds||[];

      dialog(existing?'Edit RAG Group':'Create RAG Group',
        `<input name="name" required maxlength="200" placeholder="RAG Group name" value="${esc2(existing?.name||'')}">
         <textarea name="description" maxlength="1000" placeholder="Description (optional)">${esc2(existing?.description||'')}</textarea>
         <label class="muted">Access mode</label>
         <select name="accessMode">
           <option value="GROUP_ONLY" ${existing?.accessMode==='GROUP_ONLY'?'selected':''}>Group only</option>
           <option value="GROUP_AND_DESCENDANTS" ${existing?.accessMode==='GROUP_AND_DESCENDANTS'?'selected':''}>Group + descendants</option>
           <option value="SELECTED_GROUPS" ${existing?.accessMode==='SELECTED_GROUPS'?'selected':''}>Selected groups</option>
           <option value="SELECTED_USERS" ${existing?.accessMode==='SELECTED_USERS'?'selected':''}>Selected users</option>
         </select>
         <label class="muted">Organizational Groups</label>
         <select name="groupIds" multiple>${options(state.groups,selectedGroups)}</select>
         <label class="muted">Departments / Schools (optional)</label>
         <select name="departmentIds" multiple>${options(state.departments,selectedDepartments)}</select>
         <label class="muted">Courses / Classes (optional)</label>
         <select name="courseIds" multiple>${options(state.courses,selectedCourses)}</select>
         <label><input type="checkbox" name="enabled" ${existing?.enabled!==false?'checked':''}> Enabled</label>`,
        async d=>{
          const f=d.querySelector('form');
          const vals=n=>[...f[n].selectedOptions].map(o=>o.value);

          await api(
            existing
              ? `/api/rag-groups/${encodeURIComponent(id(existing))}`
              : '/api/rag-groups',
            {
              method:existing?'PATCH':'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({
                name:f.name.value,
                description:f.description.value,
                accessMode:f.accessMode.value,
                groupIds:vals('groupIds'),
                departmentIds:vals('departmentIds'),
                courseIds:vals('courseIds'),
                enabled:f.enabled.checked
              })
            }
          );
        }
      );
    };

    window.deleteOrgItem = async function(kind,item){
      if(!confirm(`Delete ${item.name||'this item'}?`))return;
      const endpoint={department:'departments',course:'courses',group:'groups','rag':'rag-locations'}[kind];
      try{await api(`/api/${endpoint}/${encodeURIComponent(id(item))}`,{method:'DELETE'});await loadOrganizationAdmin()}catch(e){alert(e.message)}
    };

    function renderList(el,items,renderer){el.innerHTML=items.length?items.map(renderer).join(''):'<div class="org-row"><span class="org-small">None configured.</span></div>'}
    window.openEncoded = function(kind, encoded){
      const item=JSON.parse(decodeURIComponent(encoded));
      if(kind==='department') return openDepartmentForm(item);
      if(kind==='course') return openCourseForm(item);
      if(kind==='group') return openGroupForm(item);
      if(kind==='rag') return openRagForm(item);
    };
    window.deleteEncoded = function(kind, encoded){
      return deleteOrgItem(kind, JSON.parse(decodeURIComponent(encoded)));
    };

    function render(){
      renderList(document.getElementById('departmentList'),state.departments,d=>`<div class="org-row"><div><strong>${esc2(d.name)}</strong><div class="org-small">${esc2(d.code||'No code')}</div></div><div class="org-actions"><button type="button" onclick="openEncoded('department','${arg(d)}')">Edit</button><button type="button" class="danger" onclick="deleteEncoded('department','${arg(d)}')">Delete</button></div></div>`);
      renderList(document.getElementById('courseList'),state.courses,c=>{const dep=state.departments.find(d=>id(d)===String(c.departmentId));return `<div class="org-row"><div><strong>${esc2(c.name)}</strong><div class="org-small">${esc2(c.code||'No code')}${dep?' · '+esc2(dep.name):''}</div></div><div class="org-actions"><button type="button" onclick="openEncoded('course','${arg(c)}')">Edit</button><button type="button" class="danger" onclick="deleteEncoded('course','${arg(c)}')">Delete</button></div></div>`});
      renderList(
        document.getElementById('groupList'),
        state.groups,
        g=>{
          const parent=state.groups.find(x=>id(x)===String(g.parentGroupId||''));
          return `<div class="org-row">
            <div>
              <strong>${esc2(g.name)}</strong>
              ${parent?`<div class="org-small">↳ Subgroup of ${esc2(parent.name)}</div>`:''}
              <div class="org-small">${(g.memberIds||[]).length} members · ${(g.departmentIds||[]).length} departments · ${(g.courseIds||[]).length} courses · ${g.adminCount||0} admins</div>
            </div>
            <div class="org-actions">
              <button type="button" onclick="openGroupAdmins('${arg(g)}')">Admins</button>
              <button type="button" onclick="openEncoded('group','${arg(g)}')">Edit</button>
              <button type="button" class="danger" onclick="deleteEncoded('group','${arg(g)}')">Delete</button>
            </div>
          </div>`;
        }
      );
      renderList(document.getElementById('ragLocationList'),state.rag,r=>{const targetType=r.type==='DEPARTMENT'?state.departments:r.type==='COURSE'?state.courses:state.users;const target=targetType.find(x=>id(x)===String(r.targetId));return `<div class="org-row"><div><strong>${esc2(r.name)}</strong><div><span class="org-tag">${esc2(r.type)}</span><span class="org-tag ${r.enabled?'org-enabled':'org-disabled'}">${r.enabled?'Enabled':'Disabled'}</span></div><div class="org-small">${esc2(target?.email||target?.name||'')}</div></div><div class="org-actions"><button type="button" onclick="openEncoded('rag','${arg(r)}')">Edit</button><button type="button" class="danger" onclick="deleteEncoded('rag','${arg(r)}')">Delete</button></div></div>`});
      renderList(document.getElementById('ragGroupList'),state.ragGroups,r=>{
        const linked=(r.groupIds||[]).length;
        const managers=r.managerCount||0;
        return `<div class="org-row">
          <div>
            <strong>${esc2(r.name)}</strong>
            <div>
              <span class="org-tag ${r.enabled?'org-enabled':'org-disabled'}">${r.enabled?'Enabled':'Disabled'}</span>
              <span class="org-tag">${esc2(r.accessMode||'GROUP_ONLY')}</span>
            </div>
            <div class="org-small">${linked} groups · ${(r.departmentIds||[]).length} departments · ${(r.courseIds||[]).length} courses · ${managers} managers</div>
          </div>
          <div class="org-actions">
            <button type="button" onclick="openRagGroupManagers('${arg(r)}')">Managers</button>
            <button type="button" onclick="openRagGroupForm('${arg(r)}')">Edit</button>
            <button type="button" class="danger" onclick="deleteOrgItem('ragGroup',JSON.parse(decodeURIComponent('${arg(r)}')))">Delete</button>
          </div>
        </div>`;
      });
    }


    window.loadOrganizationAdmin = async function(){
      try{
        const q=scope()?`?tenantId=${encodeURIComponent(scope())}`:'';
        const [d,c,g,r,rg,u]=await Promise.all([
          api(`/api/departments${q}`),
          api(`/api/courses${q}`),
          api(`/api/groups${q}`),
          api(`/api/rag-locations${q}`),
          api(`/api/rag-groups${q}`),
          api('/api/users?role=Instructor&limit=100')
        ]);
        state.departments=d.departments||[];
        state.courses=c.courses||[];
        state.groups=g.groups||[];
        state.rag=(r.locations||[]).filter(x=>!x.automatic);
        state.ragGroups=rg.ragGroups||[];
        state.users=Array.isArray(u)?u:[];
        document.getElementById('orgScopeText').textContent=`Institution scope: ${scope()||'Platform-wide'}`;
        render();
      }catch(e){console.error('[organization-admin]',e);const n=document.getElementById('orgScopeText');if(n)n.textContent=e.message}
    };

    loadOrganizationAdmin();
  };
  boot();
})();
