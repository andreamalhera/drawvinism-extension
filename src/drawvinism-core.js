(function initDrawVinism() {
    if (typeof Draw === 'undefined' || typeof mxUtils === 'undefined') {
        setTimeout(initDrawVinism, 500);
        return;
    }

    Draw.loadPlugin(function(ui) {
        if (ui.drawVinismLoaded) return;
        ui.drawVinismLoaded = true;

        function getCurrentFileName() {
            var title = 'untitled_diagram';
            if (ui.getCurrentFile && ui.getCurrentFile()) {
                title = ui.getCurrentFile().getTitle() || title;
            } else if (document.title) {
                title = document.title.replace(' - draw.io', '').replace(' - diagrams.net', '').trim();
            }
            return title.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/\.drawio$/i, '');
        }

        function getGHConfig() {//per file
            var fileId = getCurrentFileName();
            return {
                token: localStorage.getItem('drawvinism_gh_token') || '',
                repo: localStorage.getItem('drawvinism_gh_repo') || '', // Format: "owner/repo"
                path: localStorage.getItem('drawvinism_gh_path_' + fileId) || (fileId + '.drawvinism-history.json')
            };
        }

        async function fetchGHHistory() {
            var cfg = getGHConfig();
            if (!cfg.token || !cfg.repo) return { revs: [], sha: null };

            var url = `https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}`;
            var res = await fetch(url, {
                headers: {
                    'Authorization': `token ${cfg.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (res.status === 404) return { revs: [], sha: null };
            if (!res.ok) throw new Error(`GitHub API Error (${res.status}): ${res.statusText}`);

            var data = await res.json();
            var content = decodeURIComponent(escape(atob(data.content))); // Base64 UTF-8 decode
            return { revs: JSON.parse(content), sha: data.sha };
        }

        async function saveGHHistory(newRevs, currentSha) {
            var cfg = getGHConfig();
            var url = `https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}`;
            var jsonString = JSON.stringify(newRevs, null, 2);
            var contentBase64 = btoa(unescape(encodeURIComponent(jsonString))); // Base64 UTF-8 encode

            var body = {
                message: `🧬 [DrawVinism] Evolve snapshot for file: ${getCurrentFileName()}`,
                content: contentBase64,
                sha: currentSha || undefined
            };

            var res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${cfg.token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                var errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `GitHub Save Error (${res.status})`);
            }
        }

        // --- HELPER: Full Multi-Tab XML Extractor ---
        function getFullDocumentXml() {
            var xmlDoc = mxUtils.createXmlDocument();
            var mxfile = xmlDoc.createElement('mxfile');
            mxfile.setAttribute('host', 'drawvinism');
            mxfile.setAttribute('version', '1.0');

            var pages = ui.editor.pages;
            if (pages && pages.length > 0) {
                for (var i = 0; i < pages.length; i++) {
                    var page = pages[i];
                    var diagramElement = xmlDoc.createElement('diagram');
                    diagramElement.setAttribute('id', page.getId());
                    diagramElement.setAttribute('name', page.getName());

                    var encoder = new mxCodec(xmlDoc);
                    var modelNode = encoder.encode(page.model);
                    diagramElement.appendChild(modelNode);

                    mxfile.appendChild(diagramElement);
                }
            } else {
                var diagramElement = xmlDoc.createElement('diagram');
                diagramElement.setAttribute('id', 'page-1');
                diagramElement.setAttribute('name', 'Page-1');
                var encoder = new mxCodec(xmlDoc);
                diagramElement.appendChild(encoder.encode(ui.editor.graph.model));
                mxfile.appendChild(diagramElement);
            }

            xmlDoc.appendChild(mxfile);
            return mxUtils.getXml(xmlDoc);
        }

        // --- HELPER: Native draw.io Comments (Capture + Restore) ---
        // As of the current draw.io codebase, real comment storage (DrawioFile.getComments/
        // addComment) is only implemented by Google Drive-backed files (DriveFile) — other
        // backends (GitHub, OneDrive, Dropbox, local, Trello...) inherit the no-op base
        // DrawioFile behavior. commentsSupported() reflects whatever the currently open
        // file backend reports, so this degrades gracefully everywhere else.
        function commentsSupported() {
            try {
                return typeof ui.commentsSupported === 'function' && ui.commentsSupported();
            } catch (e) {
                return false;
            }
        }

        function anchoredCommentsSupported() {
            try {
                return typeof ui.anchoredCommentsSupported === 'function' && ui.anchoredCommentsSupported();
            } catch (e) {
                return false;
            }
        }

        // DrawioComment fields: content, user {displayName, email}, createdDate, modifiedDate,
        // isResolved, anchor ({p: pageId, c: cellId} | {r: rect} | {pt: point} | null), replies[].
        function serializeComment(c) {
            return {
                content: c.content || '',
                author: (c.user && (c.user.displayName || c.user.email)) || '',
                createdDate: c.createdDate || null,
                modifiedDate: c.modifiedDate || null,
                resolved: !!c.isResolved,
                anchor: c.anchor || null,
                replies: (c.replies || []).map(function(r) {
                    return {
                        content: r.content || '',
                        author: (r.user && (r.user.displayName || r.user.email)) || '',
                        createdDate: r.createdDate || null
                    };
                })
            };
        }

        function fetchNativeComments() {
            return new Promise(function(resolve) {
                if (!commentsSupported() || typeof ui.getComments !== 'function') {
                    resolve([]);
                    return;
                }
                try {
                    ui.getComments(function(comments) {
                        resolve((comments || []).map(serializeComment));
                    }, function() {
                        resolve([]);
                    });
                } catch (e) {
                    resolve([]);
                }
            });
        }

        // Comments don't carry a stable identity across a full clear+recreate cycle (a
        // freshly-created replacement gets a brand new Drive comment id), so "is this the
        // same comment" is judged structurally: same content anchored to the same place.
        // Two genuinely distinct comments that happen to share both are treated as
        // interchangeable — an accepted edge case.
        function commentKey(c) {
            return (c.content || '') + ' ' + JSON.stringify(c.anchor || null);
        }

        function fetchLiveComments() {
            return new Promise(function(resolve) {
                if (!commentsSupported() || typeof ui.getComments !== 'function') {
                    resolve([]);
                    return;
                }
                try {
                    ui.getComments(function(liveComments) {
                        resolve(liveComments || []);
                    }, function(err) {
                        console.error('[DrawVinism] Failed to fetch live comments', err);
                        resolve([]);
                    });
                } catch (e) {
                    console.error('[DrawVinism] fetchLiveComments threw', e);
                    resolve([]);
                }
            });
        }

        // Reconciles the file's native comments to match the given snapshot, touching only
        // what actually differs: comments live on the file but absent from the snapshot get
        // deleted, comments in the snapshot but not currently live get (re-)created anchored
        // to their original shape/location, and anything already matching is left completely
        // alone — same id, same timestamp, no needless churn. This matters most for comments
        // with no shape anchor (general/file-level notes): a blind clear-then-recreate would
        // destroy and instantly recreate them, identically, on every single restore.
        //
        // Deletes are verified via re-fetch rather than trusting the delete callback alone
        // (a "success" callback only means the API call was accepted, not that a follow-up
        // read is guaranteed to reflect it), retried up to MAX_ATTEMPTS. Newly (re-)created
        // comments have their replies re-attached by re-fetching the live comment objects
        // afterwards (only those carry a working addReply(), since the base
        // DrawioComment.addReply is a backend-specific override). Finishes by calling
        // ui.commentsUpdated() (refreshes the comment cache/badges/cell overlays) and opening
        // the Comments window so the result renders as real comment cards. Any snapshot
        // comment the backend can't create is returned in `unrestored` for manual re-entry.
        function restoreNativeComments(targetComments) {
            targetComments = targetComments || [];
            var MAX_ATTEMPTS = 4;
            var keepAnchor = anchoredCommentsSupported();

            if (!commentsSupported() || typeof ui.addComment !== 'function') {
                return Promise.resolve({
                    restoredCount: 0, keptCount: 0, deletedCount: 0,
                    unrestored: targetComments, failedClearCount: 0
                });
            }

            function targetKeySet() {
                var set = {};
                targetComments.forEach(function(c) {
                    var key = commentKey({ content: c.content, anchor: keepAnchor ? c.anchor : null });
                    set[key] = (set[key] || 0) + 1;
                });
                return set;
            }

            function deleteOne(c, attempt) {
                return new Promise(function(res) {
                    if (typeof c.deleteComment !== 'function') {
                        console.warn('[DrawVinism] Comment has no deleteComment(), leaving in place:', c.id, c.content);
                        res();
                        return;
                    }
                    try {
                        c.deleteComment(function() { res(); }, function(err) {
                            console.error('[DrawVinism] Failed to delete comment (attempt ' + attempt + ')', c.id, c.content, err);
                            res();
                        });
                    } catch (e) {
                        console.error('[DrawVinism] Exception deleting comment (attempt ' + attempt + ')', c.id, c.content, e);
                        res();
                    }
                });
            }

            // Deletes whatever's live but not part of the target snapshot. Recomputes the
            // diff from a fresh fetch each attempt (not just re-deleting the same list), so
            // it converges correctly even if an earlier attempt partially succeeded.
            function pruneToTarget(n, totalDeleted) {
                return fetchLiveComments().then(function(liveComments) {
                    var remaining = targetKeySet();
                    var toDelete = [];

                    liveComments.forEach(function(c) {
                        var key = commentKey(c);
                        if (remaining[key] > 0) {
                            remaining[key]--;
                        } else {
                            toDelete.push(c);
                        }
                    });

                    if (toDelete.length === 0) {
                        return { deletedCount: totalDeleted, failedCount: 0 };
                    }

                    console.log('[DrawVinism] Prune attempt ' + n + ': removing ' + toDelete.length + ' comment(s) not part of this revision');

                    var replies = [];
                    toDelete.forEach(function(c) {
                        (c.replies || []).forEach(function(r) { replies.push(r); });
                    });

                    return Promise.all(replies.map(function(r) { return deleteOne(r, n); })).then(function() {
                        return Promise.all(toDelete.map(function(c) { return deleteOne(c, n); }));
                    }).then(function() {
                        var newTotal = totalDeleted + toDelete.length;

                        if (n >= MAX_ATTEMPTS) {
                            return fetchLiveComments().then(function(stillLive) {
                                var remaining2 = targetKeySet();
                                var stillToDelete = stillLive.filter(function(c) {
                                    var key = commentKey(c);
                                    if (remaining2[key] > 0) { remaining2[key]--; return false; }
                                    return true;
                                });
                                if (stillToDelete.length > 0) {
                                    console.error('[DrawVinism] Gave up pruning comments after ' + n + ' attempts — ' + stillToDelete.length + ' still present:', stillToDelete.map(function(c) { return c.id; }));
                                }
                                return { deletedCount: newTotal, failedCount: stillToDelete.length };
                            });
                        }

                        return pruneToTarget(n + 1, newTotal);
                    });
                });
            }

            return pruneToTarget(1, 0).then(function(pruneResult) {
                return fetchLiveComments().then(function(liveAfterPrune) {
                    var liveKeys = {};
                    liveAfterPrune.forEach(function(c) {
                        var key = commentKey(c);
                        liveKeys[key] = (liveKeys[key] || 0) + 1;
                    });

                    var toCreate = targetComments.filter(function(c) {
                        var key = commentKey({ content: c.content, anchor: keepAnchor ? c.anchor : null });
                        if (liveKeys[key] > 0) { liveKeys[key]--; return false; }
                        return true;
                    });

                    var keptCount = targetComments.length - toCreate.length;

                    function finishUp(restoredCount, unrestored) {
                        if (typeof ui.commentsUpdated === 'function') {
                            try { ui.commentsUpdated(); } catch (e) {}
                        }
                        if ((restoredCount > 0 || pruneResult.deletedCount > 0) &&
                            ui.menus && typeof ui.menus.showCommentsWindow === 'function') {
                            try { ui.menus.showCommentsWindow(); } catch (e) {}
                        }
                        return {
                            restoredCount: restoredCount, keptCount: keptCount,
                            deletedCount: pruneResult.deletedCount, unrestored: unrestored,
                            failedClearCount: pruneResult.failedCount
                        };
                    }

                    if (toCreate.length === 0) {
                        return finishUp(0, []);
                    }

                    var unrestored = [];
                    var created = [];

                    var addOne = function(c) {
                        return new Promise(function(res) {
                            var payload = { content: c.content, anchor: keepAnchor ? c.anchor : null };
                            console.log('[DrawVinism] Restoring comment', JSON.stringify(c.content), 'anchor:', JSON.stringify(payload.anchor));
                            try {
                                ui.addComment(payload, function(newId) {
                                    created.push({ newId: newId, source: c });
                                    res();
                                }, function(err) {
                                    console.error('[DrawVinism] Failed to restore comment', c.content, err);
                                    unrestored.push(c);
                                    res();
                                });
                            } catch (e) {
                                console.error('[DrawVinism] Exception restoring comment', c.content, e);
                                unrestored.push(c);
                                res();
                            }
                        });
                    };

                    return Promise.all(toCreate.map(addOne)).then(function() {
                        var withReplies = created.filter(function(entry) {
                            return entry.source.replies && entry.source.replies.length > 0;
                        });

                        if (withReplies.length === 0 || typeof ui.getComments !== 'function') {
                            return finishUp(created.length, unrestored);
                        }

                        return new Promise(function(resolve) {
                            ui.getComments(function(liveComments) {
                                var byId = {};
                                (liveComments || []).forEach(function(lc) { byId[lc.id] = lc; });

                                var replyPromises = [];
                                withReplies.forEach(function(entry) {
                                    var liveComment = byId[entry.newId];
                                    if (!liveComment || typeof liveComment.addReply !== 'function') return;

                                    entry.source.replies.forEach(function(r) {
                                        replyPromises.push(new Promise(function(res) {
                                            try {
                                                liveComment.addReply({ content: r.content }, res, res);
                                            } catch (e) {
                                                res();
                                            }
                                        }));
                                    });
                                });

                                Promise.all(replyPromises).then(function() {
                                    resolve(finishUp(created.length, unrestored));
                                });
                            }, function() {
                                resolve(finishUp(created.length, unrestored));
                            });
                        });
                    });
                });
            });
        }

        // --- REGISTER ACTIONS WITH EXPLICIT MENU LABELS ---

        // Action 1: Connect GitHub Repository
        ui.actions.put('drawVinismConfig', new Action('Connect GitHub Repository...', function() {
            var cfg = getGHConfig();
            var fileName = getCurrentFileName();

            var tokenInstructions =
                "🔑 HOW TO GENERATE A GITHUB TOKEN:\n" +
                "1. Go to https://github.com/settings/tokens\n" +
                "2. Click 'Generate new token' -> 'Fine-grained token'.\n" +
                "3. Select your repository under 'Repository access'.\n" +
                "4. Under 'Repository permissions', set 'Contents' to 'Read and write'.\n" +
                "5. Generate token and paste it below.\n\n" +
                "-------------------------------------------\n";

            var repo = prompt(tokenInstructions + "Step 1: Enter GitHub Repo (owner/repository):", cfg.repo || '');
            if (repo === null) return;

            var token = prompt("Step 2: Enter GitHub Token (PAT):", cfg.token || '');
            if (token === null) return;

            var path = prompt(`Step 3: History File Path for [${fileName}]:`, cfg.path);
            if (path === null) return;

            localStorage.setItem('drawvinism_gh_repo', repo.trim());
            localStorage.setItem('drawvinism_gh_token', token.trim());
            localStorage.setItem('drawvinism_gh_path_' + fileName, path.trim());

            alert(`✅ GitHub Connection Saved for file: ${fileName}.drawio!`);
        }));

        // Action 2: Evolve
        ui.actions.put('drawVinismEvolve', new Action('Evolve (Create Snapshot)', async function() {
            var cfg = getGHConfig();
            var fileName = getCurrentFileName();

            if (!cfg.token || !cfg.repo) {
                alert('⚠️ No GitHub connection configured.\n\nPlease go to: Extras > DrawVinism 🧬 > Connect GitHub Repository... first.');
                return;
            }

            var label = prompt(`[DrawVinism - ${fileName}] Enter Evolution Stage Label (e.g., v1.2 - Post Peer-Review):`);
            if (!label) return;

            try {
                var xmlData = getFullDocumentXml();
                var comments = await fetchNativeComments();
                var historyData = await fetchGHHistory();
                var revs = historyData.revs;
                var sha = historyData.sha;

                revs.push({
                    id: Date.now(),
                    file: fileName,
                    label: label,
                    timestamp: new Date().toISOString(),
                    data: xmlData,
                    comments: comments
                });

                await saveGHHistory(revs, sha);

                var commentNote = comments.length > 0
                    ? `\n💬 ${comments.length} comment(s) captured.`
                    : '';
                alert(`🧬 [DrawVinism] Revision stage "${label}" committed to GitHub!\nFile: ${cfg.path}` + commentNote);
            } catch (err) {
                alert('❌ Error committing to GitHub: ' + err.message);
            }
        }));

        // Action 3: View Evolutionary History
        ui.actions.put('drawVinismHistory', new Action('View Evolutionary History...', async function() {
            var cfg = getGHConfig();
            var fileName = getCurrentFileName();

            if (!cfg.token || !cfg.repo) {
                alert('⚠️ No GitHub connection configured.\n\nPlease go to: Extras > DrawVinism 🧬 > Connect GitHub Repository... first.');
                return;
            }

            try {
                var historyData = await fetchGHHistory();
                var revs = historyData.revs;

                if (!revs || revs.length === 0) {
                    alert(`🧬 No evolution stages recorded in GitHub for [${fileName}] yet.`);
                    return;
                }

                var listText = revs.map(function(r, idx) {
                    var commentTag = (r.comments && r.comments.length > 0) ? (' 💬' + r.comments.length) : '';
                    return idx + ': ' + r.label + ' (' + new Date(r.timestamp).toLocaleString() + ')' + commentTag;
                }).join('\n');

                var choice = prompt(`[DrawVinism - ${fileName}] Select Evolution Index to Revert To:\n\n` + listText);
                if (choice !== null && revs[choice]) {
                    var rev = revs[choice];

                    // ui.editor.setGraphXml() only understands a single <mxGraphModel>/<diagram>
                    // node: handed a multi-page <mxfile> (what getFullDocumentXml() produces), it
                    // silently keeps just one page and drops the rest (see Editor.extractGraphModel,
                    // which without allowMxFile picks diagrams[urlParams['page'] || 0]). replaceFileData()
                    // is the multi-page-aware "replace the whole file" call draw.io itself uses; it
                    // rebuilds every page/tab instead of only the first, so shapes on every tab exist
                    // again before any anchored comment lookups run below.
                    ui.replaceFileData(rev.data);

                    var commentsNote = '';
                    var result = await restoreNativeComments(rev.comments || []);

                    if (result.restoredCount > 0) {
                        commentsNote += `\n💬 ${result.restoredCount} comment(s) (re-)created for this revision.`;
                    }
                    if (result.keptCount > 0) {
                        commentsNote += `\n💬 ${result.keptCount} comment(s) already matched this revision and were left untouched.`;
                    }
                    if (result.deletedCount > 0) {
                        commentsNote += `\n🗑️ ${result.deletedCount} comment(s) not part of this revision were removed.`;
                    }
                    if (result.unrestored.length > 0) {
                        var reason = commentsSupported()
                            ? 'could not be re-created'
                            : "this file's storage backend doesn't support native comments (currently only Google Drive-backed files do)";
                        commentsNote += `\n⚠️ ${result.unrestored.length} comment(s) ${reason} — recorded here for manual re-entry:\n` +
                            result.unrestored.map(function(c, i) {
                                return (i + 1) + '. ' + (c.author || 'Unknown') + ': ' + c.content;
                            }).join('\n');
                    }
                    if (result.failedClearCount > 0) {
                        commentsNote += `\n⚠️ ${result.failedClearCount} comment(s) outside this revision could not be removed — they're still on the file alongside the restored set (see the browser console for why).`;
                    }

                    alert(`🧬 [DrawVinism] Entire diagram (all tabs) reverted to: ${rev.label}` + commentsNote);
                }
            } catch (err) {
                alert('❌ Error loading history from GitHub: ' + err.message);
            }
        }));

        // Action 4: About DrawVinism (Custom draw.io Modal Dialog)
        ui.actions.put('drawVinismAbout', new Action('About DrawVinism 🧬', function() {
            var content = document.createElement('div');
            content.style.padding = '12px 18px';
            content.style.lineHeight = '1.6';
            content.style.maxHeight = '420px';
            content.style.overflowY = 'auto';
            content.style.fontFamily = 'Helvetica, Arial, sans-serif';
            content.style.fontSize = '13px';

            content.innerHTML =
                '<h2 style="margin-top:0; color:#2b579a;">DrawVinism 🧬 v__VERSION__</h2>' +
                '<p><b>Survival of the fittest diagram:</b> Persistent, FAIR-compliant scientific modeling.</p>' +
                '<hr style="border:0; border-top:1px solid #ddd; margin:12px 0;">' +
                '<h4 style="margin:8px 0;">QUICK-START INSTRUCTIONS:</h4>' +
                '<ol style="padding-left:20px; margin:6px 0;">' +
                  '<li><b>Connect GitHub:</b><br>Go to <i>Extras &gt; DrawVinism 🧬 &gt; Connect GitHub Repository...</i><br>' +
                      'Enter your repository (e.g., <code>username/my-diagrams</code>) and a Fine-Grained Access Token with <code>Contents: Read/Write</code> permissions.</li>' +
                  '<li style="margin-top:8px;"><b>Evolve (Save Snapshot):</b><br>Click <i>Extras &gt; DrawVinism 🧬 &gt; Evolve (Create Snapshot)</i>.<br>' +
                      'Enter a label (e.g., <code>v1.1 - Peer Review Feedback</code>). Saves all tabs/pages and, when the file\'s backend supports it, the diagram\'s native comments (including their anchored shape/location) into a dedicated history file on GitHub.</li>' +
                  '<li style="margin-top:8px;"><b>Restore History:</b><br>Click <i>Extras &gt; DrawVinism 🧬 &gt; View Evolutionary History...</i><br>' +
                      'Select an index to restore the entire multi-tab diagram to that stage. <b>Native comments are replaced</b> (whatever comments currently exist on the file are deleted) with the snapshot\'s comments, re-created anchored back to their original shape/location, when the currently open file\'s backend supports native comments (currently Google Drive-backed files only). Comments that can\'t be restored are listed for manual re-entry.</li>' +
                  '<li style="margin-top:8px;"><b>Per-File Isolation:</b><br>Each <code>.drawio</code> file automatically maintains its own isolated <code>.drawvinism-history.json</code> file on GitHub!</li>' +
                '</ol>';

            var dlg = new CustomDialog(ui, content, function() {}, null, 'Close');
            ui.showDialog(dlg.container, 480, 420, true, true);
        }));

        // --- SUBMENU CONSTRUCTION ---
        ui.menus.put('drawVinismSubmenu', new Menu(mxUtils.bind(ui, function(menuManager, parent) {
            ui.menus.addMenuItems(menuManager, [
                'drawVinismEvolve',
                'drawVinismHistory',
                '-',
                'drawVinismConfig',
                'drawVinismAbout'
            ], parent);
        })));

        var extrasMenu = ui.menus.get('extras');
        if (extrasMenu) {
            var oldExtrasFunct = extrasMenu.funct;
            extrasMenu.funct = function(menuManager, parent) {
                oldExtrasFunct.apply(this, arguments);
                ui.menus.addMenuItems(menuManager, ['-'], parent);
                ui.menus.addSubmenu('drawVinismSubmenu', menuManager, parent, 'DrawVinism 🧬');
            };
        }
    });
})();
