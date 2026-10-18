// Inochi2D Puppet Reader client UI component.
// Renders the inspector dashboard when opened from Home -> Inochi2D Puppets tab.

export function renderPuppetInspector(container, { api }) {
  container.innerHTML = `
    <div class="mari-pane" style="padding: 1.5rem; max-width: 960px; margin: 0 auto; font-family: inherit;">
      <header style="margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <h1 style="margin: 0; font-size: 1.6rem; font-weight: 700;">Inochi2D Puppet Inspector</h1>
          <p style="margin: 0.25rem 0 0; opacity: 0.75; font-size: 0.9rem;">
            Inspect 2.5D animated .inp models, expressions, and texture atlases.
          </p>
        </div>
        <button id="btn-refresh" class="mari-chrome-control" style="padding: 0.5rem 1rem; cursor: pointer;">
          Refresh Puppets
        </button>
      </header>

      <section style="margin-bottom: 2rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem;">
        <h2 style="margin-top: 0; font-size: 1.1rem;">Load Puppet File (.inp)</h2>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
          <input id="input-puppet-path" type="text" placeholder="C:/path/to/character.inp" style="flex: 1; padding: 0.5rem 0.75rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.2); color: inherit;" />
          <button id="btn-load-path" class="mari-chrome-control" style="padding: 0.5rem 1.25rem; cursor: pointer; font-weight: 600;">
            Load & Inspect
          </button>
        </div>
        <div id="load-status" style="margin-top: 0.5rem; font-size: 0.85rem;"></div>
      </section>

      <main id="puppet-details" style="display: none;">
        <!-- Filled dynamically upon loading a puppet -->
      </main>
    </div>
  `;

  const pathInput = container.querySelector("#input-puppet-path");
  const loadBtn = container.querySelector("#btn-load-path");
  const statusDiv = container.querySelector("#load-status");
  const detailsMain = container.querySelector("#puppet-details");

  async function loadPuppet(path) {
    statusDiv.textContent = "Unpacking .inp container...";
    statusDiv.style.color = "var(--mari-text-muted, #aaa)";
    try {
      const res = await api.fetch("/load-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load puppet");
      statusDiv.textContent = `Successfully loaded ${data.summary.meta.name}!`;
      statusDiv.style.color = "#4ade80";
      renderDetails(data.id, data.summary);
    } catch (err) {
      statusDiv.textContent = err.message;
      statusDiv.style.color = "#f87171";
    }
  }

  function renderDetails(id, summary) {
    detailsMain.style.display = "block";
    const { meta, counts, parameters } = summary;
    detailsMain.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 1.5rem;">
        <div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
            <h3 style="margin-top: 0; font-size: 1.2rem;">${meta.name}</h3>
            <p style="font-size: 0.85rem; opacity: 0.8; margin: 0.25rem 0;"><strong>Version:</strong> ${meta.version}</p>
            <p style="font-size: 0.85rem; opacity: 0.8; margin: 0.25rem 0;"><strong>Rigger:</strong> ${meta.rigger}</p>
            <p style="font-size: 0.85rem; opacity: 0.8; margin: 0.25rem 0;"><strong>Artist:</strong> ${meta.artist}</p>
            <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 0.75rem 0;" />
            <p style="font-size: 0.85rem; margin: 0.25rem 0;">Nodes: <strong>${counts.nodesTotal}</strong> (Parts: ${counts.partsTotal})</p>
            <p style="font-size: 0.85rem; margin: 0.25rem 0;">Textures: <strong>${counts.texturesTotal}</strong> (${Math.round(counts.textureBytesTotal / 1024)} KB)</p>
            <p style="font-size: 0.85rem; margin: 0.25rem 0;">Parameters: <strong>${counts.parametersTotal}</strong></p>
          </div>

          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem;">
            <h4 style="margin-top: 0; font-size: 0.95rem;">Master Texture Page</h4>
            <img src="${api.resolveUrl(`/puppets/${id}/textures/0`)}" style="width: 100%; border-radius: 4px; background: rgba(0,0,0,0.4);" />
          </div>
        </div>

        <div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem;">
            <h3 style="margin-top: 0; font-size: 1.1rem;">Rigged Parameters & Expressions</h3>
            ${Object.entries(parameters).map(([cat, list]) => `
              <div style="margin-bottom: 1rem;">
                <h4 style="margin: 0.5rem 0; font-size: 0.9rem; text-transform: uppercase; color: var(--mari-primary, #60a5fa);">${cat} (${list.length})</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
                  ${list.map(p => `
                    <span style="display: inline-block; padding: 0.25rem 0.6rem; background: rgba(255,255,255,0.06); border-radius: 4px; font-size: 0.8rem;">
                      ${p.name} <span style="opacity: 0.5;">[${p.min[0]}, ${p.max[0]}]</span>
                    </span>
                  `).join("")}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  loadBtn.addEventListener("click", () => {
    const val = pathInput.value.trim();
    if (val) loadPuppet(val);
  });
}

export function activate(context) {
  context.api.registerHomeBrowserTab?.({
    id: "puppet-inp",
    label: "Inochi2D",
    render: (el) => renderPuppetInspector(el, { api: context.api }),
  });
}
