// change_list.js
// The Jira issue's Gerrit change list: a row per change with comment / web link
// icons, checkboxes with "select all", and the two bulk buttons. Shared by the
// popup (Jira mode) and the dialog the Jira page FAB opens, so both behave alike.
// Writes go through `send` (the runtime message sender of the caller).

(function initChangeList(root) {
  'use strict';

  // Colors are theme.js variables: the popup defines them on :root, the Jira page
  // dialog sets them on its own element (Theme.applyVars).
  const CSS = `
.cl { color: var(--ink); font-size: 12.5px; line-height: 1.5; }
.cl * { box-sizing: border-box; }
.cl-row { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--soft); }
.cl-row:hover { background: var(--accent-soft); }
.cl-head { background: var(--soft); color: var(--sub); font-size: 12px; position: sticky; top: 0; z-index: 1; }
.cl-head:hover { background: var(--soft); }
.cl-head label { display: flex; gap: 10px; align-items: center; cursor: pointer; }
.cl-pick { width: 16px; flex: none; display: flex; }
.cl-pick input, .cl-head input { margin: 0; accent-color: var(--accent); }
.cl-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
.cl-subj { font-weight: 600; word-break: break-word; color: inherit; text-decoration: none; }
.cl-subj:hover { text-decoration: underline; }
.cl-meta { color: var(--sub); font-size: 11.5px; }
.cl-badge { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 10.5px; font-weight: 700; color: #fff; margin-right: 4px; vertical-align: 1px; background: #8a94a6; }
.cl-badge.MERGED { background: var(--ok-fill); } .cl-badge.NEW { background: var(--fill); } .cl-badge.WIP { background: var(--warn-fill); }
.cl-tag { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 10.5px; font-weight: 600; border: 1px solid currentColor; margin-left: 4px; vertical-align: 1px; }
.cl-tag.warn { color: var(--warn); } .cl-tag.mute { color: var(--sub); }
.cl-icons { display: flex; gap: 8px; flex: none; }
.cl-ico { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 28px; border: 1px solid var(--accent); background: var(--surface); color: var(--accent); border-radius: 7px; padding: 0; cursor: pointer; }
.cl-ico svg { width: 16px; height: 16px; }
.cl-ico.wide { width: auto; height: auto; gap: 6px; padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 600; }
.cl-ico.wide .cl-mark { top: -6px; right: -6px; }
.cl-ico.has { border-color: var(--line); color: var(--mute); background: var(--soft); }
.cl-ico.has.locked, .cl-ico[aria-disabled="true"] { cursor: default; }
.cl-ico.unknown { border-color: var(--line); border-style: dashed; color: var(--sub); }
.cl-ico.busy { border-color: var(--line); color: var(--sub); cursor: progress; }
.cl-ico.fail { border-color: var(--err); color: var(--err); }
.cl-mark { position: absolute; top: -6px; right: -6px; width: 14px; height: 14px; border-radius: 50%; font-size: 9px; line-height: 14px; text-align: center; font-weight: 700; color: #fff; }
.cl-ico.has .cl-mark { background: var(--ok-fill); } .cl-ico.unknown .cl-mark { background: var(--sub); }
.cl-ico:focus-visible, .cl-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.cl-inline { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--warn); }
.cl-inline.ok { color: var(--ok); } .cl-inline.err { color: var(--err); }
.cl-btn { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 7px; padding: 6px 10px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.cl-btn.primary { background: var(--fill); border-color: var(--fill); color: var(--fill-ink); }
.cl-btn:disabled { cursor: not-allowed; color: var(--mute); background: var(--soft); border-color: var(--line); }
.cl-inline .cl-btn { padding: 3px 8px; font-size: 12px; }
/* Inside a scrolling box the select-all row and the bulk buttons stay in view. */
.cl-foot { padding: 10px 12px; display: grid; gap: 8px; background: var(--soft); position: sticky; bottom: 0; border-top: 1px solid var(--line); }
.cl-foot-line { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.cl-foot-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.cl-note { font-size: 12px; color: var(--sub); }
.cl-banner { padding: 8px 10px; border-radius: 7px; font-size: 12.5px; display: grid; gap: 6px; white-space: pre-line; }
.cl-banner.ok { background: var(--ok-soft); color: var(--ok); }
.cl-banner.warn { background: var(--warn-soft); color: var(--warn); }
.cl-banner.err { background: var(--err-soft); color: var(--err); }
.cl-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.cl-more { display: inline-block; color: var(--accent); font-weight: 600; }
`;

  const SVG = {
    comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  };

  const t = (key, vars) => root.I18N.t(key, vars);

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // An icon's state: fresh (not there yet), has, unknown (could not check), busy, fail.
  // `label`, when given, is shown next to the icon (the popup's Gerrit buttons).
  function paintIcon(btn, kind, state, label) {
    btn.className = ['cl-ico', label ? 'wide' : '', state === 'fresh' ? '' : state, kind === 'link' && state === 'has' ? 'locked' : '']
      .filter(Boolean).join(' ');
    btn.innerHTML = SVG[kind];
    if (label) btn.append(el('span', 'cl-ico-label', state === 'busy' ? t('list.busy') : label));
    if (state === 'has' || state === 'unknown') btn.append(el('span', 'cl-mark', state === 'has' ? '✓' : '?'));
    const tip = t(`list.tip.${kind}.${state}`);
    btn.title = tip;
    btn.setAttribute('aria-label', tip);
    // aria-disabled rather than disabled, so the tooltip still shows on hover.
    if (kind === 'link' && state === 'has') btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  }

  /**
   * @param {HTMLElement} host emptied and filled with the list
   * @param {{ issueKey: string, resp: any, send: (msg: object) => Promise<any> }} opts
   *   resp is the GET_GERRIT_CHANGES answer with at least one change.
   */
  function render(host, { issueKey, resp, send }) {
    const rows = resp.changes.map((c) => ({
      ...c,
      // A change whose message only mentions this issue is really another issue's work.
      primary: !c.mainKey || c.mainKey === issueKey,
      merged: c.status === 'MERGED',
      // mine is null when the Gerrit account is unknown: then nobody is a "teammate".
      peer: c.mine === false,
    }));
    const needsC = (r) => r.merged && r.commented === false;
    const needsL = (r) => r.merged && r.linked === false;
    const pickable = (r) => needsC(r) || needsL(r);
    // Only my own changes that are clearly this issue's start checked.
    rows.forEach((r) => { r.checked = needsC(r) && r.primary && !r.revert && r.mine === true; });
    let running = false;

    host.textContent = '';
    const box = el('div', 'cl');
    const list = el('div');
    const foot = el('div', 'cl-foot');
    const footLine = el('div', 'cl-foot-line');
    const selNote = el('span', 'cl-note');
    const btns = el('span', 'cl-foot-btns');
    const bulkC = el('button', 'cl-btn primary');
    const bulkL = el('button', 'cl-btn');
    bulkC.type = bulkL.type = 'button';
    btns.append(bulkC, bulkL);
    footLine.append(selNote, btns);
    const area = el('div');
    foot.append(footLine, area);
    box.append(list, foot);
    if (resp.more && resp.searchUrl) {
      const more = el('a', 'cl-more', t('gerrit.viewAll'));
      more.href = resp.searchUrl;
      more.target = '_blank';
      more.rel = 'noopener noreferrer';
      foot.append(more);
    }
    host.append(box);

    const setArea = (kind, text) => {
      area.textContent = '';
      if (text) area.append(el('div', `cl-banner ${kind}`, text));
    };

    function inline(main, kind, text, ms) {
      main.querySelector('.cl-inline')?.remove();
      const note = el('div', `cl-inline ${kind}`, text);
      main.append(note);
      if (ms) setTimeout(() => note.remove(), ms);
    }

    function confirmIn(main, text, onYes) {
      main.querySelector('.cl-inline')?.remove();
      const box2 = el('div', 'cl-inline', text);
      const yes = el('button', 'cl-btn primary', t('list.confirm.yes'));
      const no = el('button', 'cl-btn', t('list.confirm.no'));
      yes.type = no.type = 'button';
      yes.onclick = () => { box2.remove(); onYes(); };
      no.onclick = () => box2.remove();
      box2.append(yes, no);
      main.append(box2);
    }

    function cState(r) {
      if (r.cBusy) return 'busy';
      if (r.cFail) return 'fail';
      if (r.commented === null) return 'unknown';
      return r.commented ? 'has' : 'fresh';
    }
    function lState(r) {
      if (r.lBusy) return 'busy';
      if (r.lFail) return 'fail';
      if (r.linked === null) return 'unknown';
      return r.linked ? 'has' : 'fresh';
    }

    // One write for one change. Resolves to true when it may count as done.
    async function write(r, part, force) {
      const busyKey = part === 'link' ? 'lBusy' : 'cBusy';
      const failKey = part === 'link' ? 'lFail' : 'cFail';
      r[busyKey] = true;
      r[failKey] = false;
      paintAll();
      let res;
      try {
        res = await send({ type: root.MESSAGE_TYPES.JIRA_LIST_ADD, issueKey, project: r.project, changeNum: r.number, part, force });
      } catch {
        res = { ok: false, message: t('cs.toast.requestError') };
      }
      r[busyKey] = false;
      if (res?.ok || res?.duplicate) {
        if (part === 'link') r.linked = true; else r.commented = true;
      } else if (res?.unknown) {
        r.commented = null;
      } else {
        r[failKey] = true;
      }
      paintAll();
      return res || { ok: false, message: t('cs.toast.requestError') };
    }

    async function runOne(r, part, force) {
      const res = await write(r, part, force);
      const main = r.mainEl;
      if (res.ok) inline(main, 'ok', t(part === 'link' ? 'list.done.link' : 'list.done.comment'), 2400);
      else inline(main, res.duplicate ? 'warn' : 'err', res.message || t('cs.toast.requestError'), 4000);
    }

    function onComment(r) {
      if (running || r.cBusy) return;
      const main = r.mainEl;
      // Checked again on "yes": a bulk run or another write may have started meanwhile.
      const go = (force) => { if (!running && !r.cBusy) runOne(r, 'comment', force); };
      if (r.commented) { confirmIn(main, t('list.confirm.again'), () => go(true)); return; }
      if (r.commented === null) { confirmIn(main, t('list.confirm.unknown'), () => go(true)); return; }
      if (r.revert) { confirmIn(main, t('list.confirm.revert'), () => go(false)); return; }
      if (!r.primary) { confirmIn(main, t('list.confirm.other', { mainKey: r.mainKey, issueKey }), () => go(false)); return; }
      if (r.peer) { confirmIn(main, t('list.confirm.peer'), () => go(false)); return; }
      go(false);
    }

    function onLink(r) {
      // A web link of the same change is overwritten, so there is nothing to redo.
      if (running || r.lBusy || r.linked) return;
      runOne(r, 'link', false);
    }

    // Bulk: one change at a time, stop at the first failure and leave the rest checked.
    // `targets` is the set the confirm showed, so a later checkbox change cannot add to it.
    async function runBulk(part, targets) {
      if (!targets.length || running || rows.some((r) => r.cBusy || r.lBusy)) return;
      running = true;
      setArea('', '');
      // A row confirm left open must not fire into the run.
      rows.forEach((r) => r.mainEl?.querySelector('.cl-inline')?.remove());
      paintAll();
      let done = 0;
      for (const r of targets) {
        // Closing the dialog, or a new render of the list, stops the run.
        if (!box.isConnected) { running = false; return; }
        const res = await write(r, part, false);
        if (!res.ok && !res.duplicate) {
          running = false;
          paintAll();
          const rest = targets.length - done - 1;
          // An unknown result drops the row's checkbox, so it is not "left checked".
          const key = res.unknown ? (rest ? 'list.bulk.stoppedUnknownRest' : 'list.bulk.stoppedUnknown')
            : rest ? 'list.bulk.stoppedRest' : 'list.bulk.stopped';
          setArea('err', t(key, { done, number: r.number, reason: res.message || '', rest }));
          return;
        }
        done += 1;
      }
      running = false;
      // A row stays checked while it still lacks the other part.
      rows.forEach((r) => { if (!pickable(r)) r.checked = false; });
      paintAll();
      setArea('ok', t(part === 'link' ? 'list.bulk.linkDone' : 'list.bulk.commentDone', { n: done }));
    }

    bulkC.onclick = () => {
      const picked = rows.filter((r) => r.checked && needsC(r));
      if (!picked.length || running) return;
      const extra = [
        [picked.filter((r) => r.peer).length, 'list.bulk.peers'],
        [picked.filter((r) => r.revert).length, 'list.bulk.reverts'],
        [picked.filter((r) => !r.primary).length, 'list.bulk.others'],
      ].filter(([n]) => n).map(([n, key]) => t(key, { n })).join(', ');
      area.textContent = '';
      const banner = el('div', 'cl-banner warn', t(extra ? 'list.bulk.confirmWith' : 'list.bulk.confirm', {
        numbers: picked.map((r) => r.number).join(', '), n: picked.length, extra,
      }));
      const acts = el('div', 'cl-acts');
      const go = el('button', 'cl-btn primary', t('list.bulk.go', { n: picked.length }));
      const no = el('button', 'cl-btn', t('list.confirm.no'));
      go.type = no.type = 'button';
      go.onclick = () => runBulk('comment', picked);
      no.onclick = () => setArea('', '');
      acts.append(go, no);
      banner.append(acts);
      area.append(banner);
    };
    // Web links send no notification and overwrite themselves: no confirm.
    bulkL.onclick = () => runBulk('link', rows.filter((r) => r.checked && needsL(r)));

    function headRow() {
      const head = el('div', 'cl-row cl-head');
      const all = rows.filter(pickable);
      if (!all.length) {
        head.textContent = t(rows.some((r) => r.merged && (r.commented === null || r.linked === null)) ? 'list.head.unknown' : 'list.head.allDone');
        return head;
      }
      const label = el('label');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.disabled = running;
      const on = all.filter((r) => r.checked).length;
      cb.checked = on === all.length;
      cb.indeterminate = on > 0 && !cb.checked;
      cb.onchange = () => { all.forEach((r) => { r.checked = cb.checked; }); setArea('', ''); paintAll(); };
      label.append(cb, document.createTextNode(t('list.head.selectAll', { on, total: all.length })));
      head.append(label);
      return head;
    }

    function rowEl(r) {
      const row = el('div', 'cl-row');
      const pick = el('span', 'cl-pick');
      if (pickable(r)) {
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !!r.checked;
        cb.disabled = running;
        cb.setAttribute('aria-label', t('list.pick', { number: r.number }));
        // A changed selection cancels an open bulk confirm; its counts would be stale.
        cb.onchange = () => { r.checked = cb.checked; setArea('', ''); paintAll(); };
        pick.append(cb);
      }

      const main = el('div', 'cl-main');
      const subj = el('a', 'cl-subj');
      subj.href = r.url;
      subj.target = '_blank';
      subj.rel = 'noopener noreferrer';
      subj.append(el('span', `cl-badge ${r.status}`, r.status), `${r.number} · ${r.subject}`);
      if (r.revert) subj.append(el('span', 'cl-tag warn', 'REVERT'));
      if (!r.primary) subj.append(el('span', 'cl-tag warn', t('list.tag.other', { mainKey: r.mainKey })));
      if (r.peer) subj.append(el('span', 'cl-tag mute', t('list.tag.peer')));
      const meta = [`${r.project} / ${r.branch}`, r.owner, r.date, r.cherryOf ? t('list.cherryOf', { number: r.cherryOf }) : '']
        .filter(Boolean).join(' · ');
      main.append(subj, el('div', 'cl-meta', meta));
      // Keep a note that is still showing (a confirm or a result) across repaints.
      const keep = r.mainEl?.querySelector('.cl-inline');
      if (keep) main.append(keep);
      r.mainEl = main;
      row.append(pick, main);

      if (r.merged) {
        const icons = el('span', 'cl-icons');
        const ic = el('button');
        const il = el('button');
        ic.type = il.type = 'button';
        paintIcon(ic, 'comment', cState(r));
        paintIcon(il, 'link', lState(r));
        if (running) { ic.setAttribute('aria-disabled', 'true'); il.setAttribute('aria-disabled', 'true'); }
        ic.onclick = () => onComment(r);
        il.onclick = () => onLink(r);
        icons.append(ic, il);
        row.append(icons);
      }
      return row;
    }

    function paintAll() {
      list.textContent = '';
      list.append(headRow(), ...rows.map(rowEl));
      const pc = rows.filter((r) => r.checked && needsC(r)).length;
      const pl = rows.filter((r) => r.checked && needsL(r)).length;
      bulkC.textContent = t('list.bulk.comment', { n: pc });
      bulkL.textContent = t('list.bulk.link', { n: pl });
      bulkC.disabled = running || !pc;
      bulkL.disabled = running || !pl;
      const merged = rows.filter((r) => r.merged);
      const unknown = merged.some((r) => r.commented === null);
      selNote.textContent = unknown
        ? t('list.note.unknown')
        : t('list.note.left', { n: merged.filter((r) => r.commented === false).length });
    }

    paintAll();
  }

  root.ChangeList = { CSS, render, paintIcon };
})(typeof self !== 'undefined' ? self : window);
