/**
 * DrawVinism 🧬 - Extension Content Script
 */
function initDrawVinism() {
    // Wait until draw.io's core engine is fully loaded in the window DOM
    if (typeof Draw === 'undefined' || typeof mxUtils === 'undefined') {
        setTimeout(initDrawVinism, 250);
        return;
    }

    Draw.loadPlugin(function(ui) {
        ui.editor.graph.model.revisions = ui.editor.graph.model.revisions || [];

        // Action 1: Record Snapshot
        ui.actions.addAction('drawVinismEvolve', function() {
            var name = prompt('[DrawVinism] Enter Evolution Stage Label (e.g., v1.2 - Post Peer-Review):');
            if (!name) return;

            var enc = new mxCodec();
            var node = enc.encode(ui.editor.graph.getModel());
            var xmlString = mxUtils.getXml(node);

            ui.editor.graph.model.revisions.push({
                id: Date.now(),
                label: name,
                timestamp: new Date().toISOString(),
                data: xmlString
            });
            alert('🧬 [DrawVinism] Evolution stage captured in file metadata!');
        });

        // Action 2: Inspect & Restore History
        ui.actions.addAction('drawVinismHistory', function() {
            var revs = ui.editor.graph.model.revisions;
            if (!revs || revs.length === 0) {
                alert('🧬 [DrawVinism] No evolutionary stages recorded in this diagram yet.');
                return;
            }

            var listText = revs.map(function(r, idx) {
                return idx + ': ' + r.label + ' (' + new Date(r.timestamp).toLocaleString() + ')';
            }).join('\n');

            var choice = prompt('[DrawVinism] Select Evolution Index to Revert To:\n\n' + listText);
            if (choice !== null && revs[choice]) {
                var doc = mxUtils.parseXml(revs[choice].data);
                var dec = new mxCodec(doc);
                
                ui.editor.graph.getModel().beginUpdate();
                try {
                    dec.decode(doc.documentElement, ui.editor.graph.getModel());
                } finally {
                    ui.editor.graph.getModel().endUpdate();
                }
                alert('🧬 [DrawVinism] Diagram reverted to stage: ' + revs[choice].label);
            }
        });

        // Action 3: About
        ui.actions.addAction('drawVinismAbout', function() {
            alert('DrawVinism 🧬 v1.0\n\nSurvival of the fittest diagram.\nEmbedded revision tracking for FAIR-compliant scientific modeling.');
        });

        // Build Extras Submenu
        ui.menus.put('drawVinismSubmenu', new Menu(mxUtils.bind(ui, function(menuManager, parent) {
            ui.menus.addMenuItems(menuManager, ['drawVinismEvolve', 'drawVinismHistory', '-', 'drawVinismAbout'], parent);
        })));

        var extrasMenu = ui.menus.get('extras');
        var oldExtrasFunct = extrasMenu.funct;
        
        extrasMenu.funct = function(menuManager, parent) {
            oldExtrasFunct.apply(this, arguments);
            ui.menus.addMenuItems(menuManager, ['-'], parent);
            ui.menus.addSubmenu('drawVinismSubmenu', menuManager, parent, 'DrawVinism 🧬');
        };
    });
}

// Inject directly into page script context to bypass extension isolation
var script = document.createElement('script');
script.textContent = '(' + initDrawVinism.toString() + ')();';
(document.head || document.documentElement).appendChild(script);
script.remove();
