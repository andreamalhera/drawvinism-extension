/**
 * DrawVinism 🧬
 * Survival of the fittest diagram — Embedded Revision Control for draw.io
 */
Draw.loadPlugin(function(ui) {
    // Structure to hold custom revision metadata inside the diagram model
    ui.editor.graph.model.revisions = ui.editor.graph.model.revisions || [];

    // Action 1: Evolve (Create a revision snapshot)
    ui.actions.addAction('drawVinismEvolve', function() {
        var name = prompt('[DrawVinism] Enter Evolution Stage Label (e.g., v1.2 - Post Peer-Review Revision):');
        if (!name) return;

        // Extract current diagram XML state
        var enc = new mxCodec();
        var node = enc.encode(ui.editor.graph.getModel());
        var xmlString = mxUtils.getXml(node);

        // Store snapshot in metadata
        var rev = {
            id: Date.now(),
            label: name,
            timestamp: new Date().toISOString(),
            data: xmlString
        };

        ui.editor.graph.model.revisions.push(rev);
        alert('🧬 [DrawVinism] Evolution stage captured in file metadata!');
    });

    // Action 2: Inspect Evolutionary History (View / Restore a snapshot)
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
            var selectedXml = revs[choice].data;
            var doc = mxUtils.parseXml(selectedXml);
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

    // Action 3: About DrawVinism
    ui.actions.addAction('drawVinismAbout', function() {
        alert('DrawVinism 🧬 v1.0\n\n' +
              'Survival of the fittest diagram.\n' +
              'Embedded revision tracking for FAIR-compliant scientific modeling, ' +
              'transparent peer review, and academic research methods education.');
    });

    // Inject dedicated "DrawVinism" Submenu into draw.io Extras Menu
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
