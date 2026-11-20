import app from 'flarum/forum/app';
import Page from 'flarum/common/components/Page';
import Link from 'flarum/common/components/Link';
import LinkButton from 'flarum/common/components/LinkButton';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import Routes from 'flarum/common/extenders/Routes';
import { extend as extendMethod } from 'flarum/common/extend';
import IndexSidebar from 'flarum/forum/components/IndexSidebar';

const tr = (key, values = {}) => app.translator.trans('el-choco-editorial.forum.' + key, values);
const txt = (key, values = {}) => { const value = tr(key, values); return Array.isArray(value) ? value.join('') : String(value); };
const endpoint = (path = '') => app.forum.attribute('apiUrl') + '/editorial' + path;
const icon = (name) => m('i', { className: 'fas fa-' + name, 'aria-hidden': 'true' });
const date = (value) => new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z')).toLocaleString(app.translator.getLocale().split(/[_@]/)[0]);
const status = (value) => m('span.Editorial-status', { 'data-status': value }, tr('status_' + value));
const pendingManuscripts = new Map();
const errorCode = (error) => {
  const code = error?.response?.errors?.[0]?.code;
  return ['conflict', 'not_found', 'invalid', 'limit', 'closed', 'state', 'member', 'reviewers', 'publish_failed'].includes(code) ? code : 'request';
};
const button = (label, onclick, disabled = false, primary = false) => m('button.Button', {
  type: 'button', className: primary ? 'Button--primary' : '', onclick, disabled,
}, tr(label));

export class EditorialIndex extends Page {
  oninit(vnode) {
    super.oninit(vnode);
    this.page = 1;
    this.title = '';
    this.active = true;
    this.load();
  }

  onremove(vnode) { this.active = false; super.onremove(vnode); }

  async load() {
    this.loading = true;
    this.error = '';
    try {
      const data = await app.request({ url: endpoint(), params: { page: this.page }, errorHandler: () => {} });
      if (this.active) this.data = data;
    } catch (error) { if (this.active) this.error = errorCode(error); }
    finally { if (this.active) { this.loading = false; m.redraw(); } }
  }

  async create() {
    this.busy = true;
    this.error = '';
    try {
      const data = await app.request({ method: 'POST', url: endpoint(), body: { title: this.title, content: '', tags: [] }, errorHandler: () => {} });
      if (this.active) m.route.set(app.route('editorial.draft', { id: data.draft.id }));
    } catch (error) { if (this.active) this.error = errorCode(error); }
    finally { if (this.active) { this.busy = false; m.redraw(); } }
  }

  view() {
    return m('.Editorial', m('.container', [
      m('header.Editorial-hero', [m('span.Editorial-eyebrow', 'el-choco · Editorial'), m('h1', tr('heading')),
        m('p', tr('intro')), m('.Editorial-heroMark', { 'aria-hidden': 'true' }, icon('pen-nib'))]),
      !app.session.user ? m('.Editorial-card', tr('access')) : [
        m('form.Editorial-card.Editorial-create', { onsubmit: (event) => { event.preventDefault(); if (!this.busy && this.title.trim().length >= 3) this.create(); } }, [
          m('label', { for: 'editorial-new-title' }, tr('new_title')),
          m('input.FormControl', { id: 'editorial-new-title', value: this.title, maxlength: 80, minlength: 3, required: true,
            placeholder: txt('title_placeholder'), oninput: (event) => { this.title = event.target.value; } }),
          m('button.Button.Button--primary', { type: 'submit', disabled: this.busy || this.title.trim().length < 3 }, [icon('plus'), ' ', tr('create')]),
        ]),
        this.error && m('.Alert.Alert--error', { role: 'alert' }, tr('error_' + this.error)),
        m('.Editorial-toolbar', [m('h2', tr('workspace')), button('refresh', () => this.load(), this.loading)]),
        this.loading ? m(LoadingIndicator) : this.data && [
          !this.data.items.length && m('.Editorial-card.Editorial-empty', [icon('feather'), m('h3', tr('empty')), m('p', tr('empty_help'))]),
          m('.Editorial-grid', this.data.items.map((draft) => m(Link, { href: app.route('editorial.draft', { id: draft.id }), className: 'Editorial-card Editorial-draftCard' }, [
            status(draft.status), m('h3', draft.title), m('p', tr('revision_label', { number: draft.content_version })), m('small', date(draft.updated_at)), icon('arrow-right'),
          ]))),
          m('.Editorial-pagination', [button('previous', () => { this.page--; this.load(); }, this.page === 1), m('span', String(this.page)),
            button('next', () => { this.page++; this.load(); }, !this.data.hasMore)]),
        ],
      ],
    ]));
  }
}

export class EditorialDraft extends Page {
  oninit(vnode) {
    super.oninit(vnode);
    this.id = vnode.attrs.id ?? m.route.param('id');
    this.active = true;
    this.tab = 'write';
    this.username = '';
    this.inviteRole = 'reviewer';
    this.comment = '';
    this.tags = [];
    this.tagOptions = [];
    this.bufferKey = (app.session.user?.id() || 'guest') + ':' + this.id;
    this.recoverPending = true;
    this.beforeUnload = (event) => { if (this.dirty() || this.comment) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', this.beforeUnload);
    this.load();
    if (app.store.models.tags) {
      app.store.find('tags').then((tags) => { if (this.active) { this.tagOptions = tags; m.redraw(); } }).catch(() => {});
    }
  }

  onremove(vnode) {
    if (this.dirty() || this.comment) {
      pendingManuscripts.set(this.bufferKey, { title: this.title, content: this.content, tags: [...this.tags], comment: this.comment, version: this.data.draft.version });
    }
    this.active = false;
    window.removeEventListener('beforeunload', this.beforeUnload);
    super.onremove(vnode);
  }

  dirty() {
    return !!this.data && (this.title !== this.data.draft.title || this.content !== this.data.draft.content || JSON.stringify(this.tags) !== JSON.stringify(this.data.draft.tags));
  }

  accept(data) {
    this.data = data;
    this.title = data.draft.title;
    this.content = data.draft.content;
    this.tags = [...data.draft.tags];
    this.snapshot = null;
  }

  async load(confirm = false) {
    if (confirm && (this.dirty() || this.comment) && !window.confirm(txt('reload_confirm'))) return;
    this.loading = true;
    this.error = '';
    try {
      const data = await app.request({ url: endpoint('/' + this.id), errorHandler: () => {} });
      if (this.active) {
        this.accept(data); this.comment = '';
        const pending = this.recoverPending && pendingManuscripts.get(this.bufferKey);
        if (pending) {
          this.title = pending.title; this.content = pending.content; this.tags = [...pending.tags]; this.comment = pending.comment;
          this.recovered = true;
          if (Number(pending.version) !== Number(data.draft.version)) {
            this.data.draft.version = pending.version;
            this.error = 'conflict';
          }
        }
        this.recoverPending = false;
        pendingManuscripts.delete(this.bufferKey);
      }
    } catch (error) { if (this.active) this.error = errorCode(error); }
    finally { if (this.active) { this.loading = false; m.redraw(); } }
  }

  async action(action, extra = {}) {
    if (this.busy || !this.data) return;
    if (action !== 'save' && this.dirty()) { this.error = 'unsaved'; return; }
    if (['publish', 'delete', 'restore', 'archive'].includes(action) && !window.confirm(txt('confirm_' + action))) return;
    this.busy = true;
    this.error = '';
    try {
      const data = await app.request({ method: 'POST', url: endpoint('/' + this.id),
        body: { action, version: Number(this.data.draft.version), ...extra }, errorHandler: () => {} });
      if (!this.active) return;
      if (data.deleted) {
        this.data = null;
        this.comment = '';
        this.busy = false;
        m.route.set(app.route('editorial'));
        return;
      }
      this.accept(data);
      if (action === 'comment' || action === 'changes') this.comment = '';
      if (action === 'invite') this.username = '';
    } catch (error) { if (this.active) this.error = errorCode(error); }
    finally { if (this.active) { this.busy = false; m.redraw(); } }
  }

  async showRevision(id) {
    this.error = '';
    try {
      const data = await app.request({ url: endpoint('/' + this.id + '/revisions/' + id), errorHandler: () => {} });
      if (this.active) this.snapshot = data.revision;
    } catch (error) { if (this.active) this.error = errorCode(error); }
    finally { if (this.active) m.redraw(); }
  }

  download() {
    const url = URL.createObjectURL(new Blob([this.title + '\n\n' + this.content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'editorial-' + this.id + '.txt';
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  insert(before, after = '') {
    const input = document.getElementById('editorial-content');
    if (!input || !this.data?.canEdit || this.busy) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    this.content = this.content.slice(0, start) + before + this.content.slice(start, end) + after + this.content.slice(end);
    m.redraw.sync(); input.focus(); input.setSelectionRange(start + before.length, end + before.length);
  }

  user(id) { return this.data.users[id] || txt('deleted_user'); }

  view() {
    return m('.Editorial', m('.container', [
      m(Link, { href: app.route('editorial'), className: 'Editorial-back' }, [icon('arrow-left'), ' ', tr('back')]),
      this.error && m('.Alert.Alert--error.Editorial-alert', { role: 'alert' }, [tr('error_' + this.error),
        this.error === 'conflict' && m('.Editorial-actions', [button('download', () => this.download()), button('reload', () => this.load(true), this.busy)])]),
      this.loading ? m(LoadingIndicator) : this.data && this.workspace(),
    ]));
  }

  workspace() {
    const { draft, role, canEdit, canApprove, canPublish } = this.data;
    const owner = role === 'owner';
    const closed = ['published', 'archived'].includes(draft.status);
    const disabled = this.busy || this.dirty();
    return [
      this.recovered && m('.Alert.Editorial-alert', tr('recovered')),
      m('header.Editorial-heading', [m('div', [m('span.Editorial-eyebrow', 'Editorial · ' + txt('role_' + role)), m('h1', draft.title),
        m('p', [tr('by'), ' ', this.user(draft.owner_id), ' · ', tr('revision_label', { number: draft.content_version }), ' · ', date(draft.updated_at)])]), status(draft.status)]),
      m('nav.Editorial-steps', { 'aria-label': txt('workflow') }, ['draft', 'review', 'approved', 'published'].map((step, i) =>
        m('span', { className: step === draft.status ? 'is-current' : '' }, [m('b', String(i + 1).padStart(2, '0')), ' ', tr('status_' + step)]))),
      m('.Editorial-workspace', [
        m('main.Editorial-main', [
          m('section.Editorial-card.Editorial-editor', [
            m('.Editorial-toolbar', [m('h2', tr('manuscript')), m('span', this.dirty() ? tr('unsaved') : tr('saved'))]),
            m('.Editorial-tabs', ['write', 'team', 'history'].map((tab) => m('button.Button', { type: 'button', 'aria-pressed': this.tab === tab,
              className: this.tab === tab ? 'Button--primary' : '', onclick: () => { this.tab = tab; } }, tr('tab_' + tab)))),
            this.tab === 'write' && [
              m('label', { for: 'editorial-title' }, tr('title')),
              m('input.FormControl', { id: 'editorial-title', value: this.title, maxlength: 80, disabled: !canEdit || this.busy, oninput: (event) => { this.title = event.target.value; } }),
              m('label', { for: 'editorial-content' }, tr('content')),
              canEdit && m('.Editorial-format', [button('bold', () => this.insert('**', '**'), this.busy), button('italic', () => this.insert('*', '*'), this.busy),
                button('quote', () => this.insert('> '), this.busy), button('link', () => this.insert('[', '](https://)'), this.busy)]),
              m('textarea.FormControl.Editorial-content', { id: 'editorial-content', value: this.content, maxlength: 63000, rows: 18,
                readonly: !canEdit, disabled: this.busy, oninput: (event) => { this.content = event.target.value; } }),
              m('small.Editorial-muted', tr('format_help')),
              this.tagOptions.length > 0 && [m('label', { for: 'editorial-tags' }, tr('tags')),
                m('select.FormControl', { id: 'editorial-tags', multiple: true, disabled: !canEdit || this.busy,
                  onchange: (event) => { this.tags = Array.from(event.target.selectedOptions, (option) => Number(option.value)); } },
                  [...this.tagOptions.map((tag) => ({ id: Number(tag.id()), name: tag.name() })), ...this.tags.filter((id) => !this.tagOptions.some((tag) => Number(tag.id()) === id)).map((id) => ({ id, name: '#' + id }))]
                    .map((tag) => m('option', { value: tag.id, selected: this.tags.includes(tag.id) }, tag.name)))],
              m('.Editorial-actions', [canEdit && button('save', () => this.action('save', { title: this.title, content: this.content, tags: this.tags }), this.busy || !this.dirty(), true),
                button('download', () => this.download()), button('refresh', () => this.load(true), this.busy)]),
            ],
            this.tab === 'team' && this.team(owner, disabled),
            this.tab === 'history' && this.history(canEdit, disabled),
          ]),
          m('section.Editorial-card.Editorial-comments', [m('h2', tr('comments')), m('p.Editorial-muted', tr('private_help')),
            this.data.commentsTruncated && m('p.Alert', tr('comments_limit')),
            !this.data.comments.length && m('p.Editorial-muted', tr('no_comments')),
            ...this.data.comments.map((comment) => m('article.Editorial-comment', [
              m('header', [m('strong', this.user(comment.user_id)), m('small', [date(comment.created_at), ' · ', tr('revision_label', { number: comment.content_version })])]),
              m('p', comment.content),
            ])),
            !closed && [m('label', { for: 'editorial-comment' }, tr('comment_label')),
              m('textarea.FormControl', { id: 'editorial-comment', rows: 3, maxlength: 5000, value: this.comment, disabled: this.busy, oninput: (event) => { this.comment = event.target.value; } }),
              m('.Editorial-actions', [button('comment', () => this.action('comment', { content: this.comment }), disabled || !this.comment.trim()),
                role === 'reviewer' && ['review', 'approved'].includes(draft.status) && button('request_changes', () => this.action('changes', { content: this.comment }), disabled || !this.comment.trim())])],
          ]),
        ]),
        m('aside.Editorial-side', [
          m('section.Editorial-card.Editorial-review', [icon('clipboard-check'), m('h2', tr('review_title')),
            m('strong.Editorial-approvalCount', this.data.approvals + ' / ' + draft.required_approvals), m('p', tr('approval_help')),
            m('.Editorial-actions', [owner && draft.status === 'draft' && button('submit', () => this.action('submit'), disabled, true),
              canApprove && button('approve', () => this.action('approve'), disabled, true),
              owner && ['review', 'approved'].includes(draft.status) && button('reopen', () => this.action('reopen'), disabled),
              canPublish && button('publish', () => this.action('publish'), disabled, true)]),
            draft.discussion_id && m(Link, { href: app.route('discussion', { id: draft.discussion_id }), className: 'Button Button--primary' }, tr('open_discussion')),
          ]),
          m('section.Editorial-card', [m('h3', tr('team')), m('p', this.user(draft.owner_id) + ' · ' + txt('role_owner')),
            ...this.data.members.map((member) => m('p', [this.user(member.user_id), ' · ', tr('role_' + member.role),
              Number(member.approved_version) === Number(draft.content_version) && icon('check-circle')]))]),
          m('section.Editorial-card.Editorial-note', [icon('lock'), m('h3', tr('private_title')), m('p', tr('privacy'))]),
          owner && m('.Editorial-actions.Editorial-danger', [!closed && button('archive', () => this.action('archive'), disabled), button('delete', () => this.action('delete'), disabled)]),
        ]),
      ]),
    ];
  }

  team(owner, disabled) {
    return m('.Editorial-team', [
      m('p', tr('team_help')),
      ...this.data.members.map((member) => m('.Editorial-member', [m('div', [m('strong', this.user(member.user_id)), m('small', tr('role_' + member.role))]),
        owner && this.data.draft.status === 'draft' && button('remove', () => this.action('remove', { userId: Number(member.user_id) }), disabled)])),
      owner && this.data.draft.status === 'draft' && [
        m('label', { for: 'editorial-username' }, tr('username')),
        m('input.FormControl', { id: 'editorial-username', value: this.username, maxlength: 100, disabled: this.busy, oninput: (event) => { this.username = event.target.value; } }),
        m('label', { for: 'editorial-role' }, tr('role')),
        m('select.FormControl', { id: 'editorial-role', value: this.inviteRole, disabled: this.busy, onchange: (event) => { this.inviteRole = event.target.value; } },
          ['reviewer', 'editor'].map((role) => m('option', { value: role }, tr('role_' + role)))),
        m('.Editorial-actions', button('invite', () => this.action('invite', { username: this.username, role: this.inviteRole }), disabled || !this.username.trim(), true)),
      ],
    ]);
  }

  history(canEdit, disabled) {
    return m('.Editorial-history', [
      this.data.historyTruncated && m('p.Alert', tr('history_limit')),
      this.snapshot && m('.Editorial-snapshot', [m('h3', [tr('revision_label', { number: this.snapshot.content_version }), ' · ', this.snapshot.title]),
        m('pre', this.snapshot.content), m('p', tr('restore_help')),
        canEdit && button('restore', () => this.action('restore', { revision: Number(this.snapshot.id) }), disabled)]),
      ...this.data.history.map((item) => m('article.Editorial-event', [
        m('div', [m('strong', tr('action_' + item.action)), m('small', [this.user(item.actor_id), ' · ', date(item.created_at), ' · ', tr('revision_label', { number: item.content_version })]),
          item.detail && m('small', item.detail)]),
        ['create', 'save', 'restore'].includes(item.action) && button('view_revision', () => this.showRevision(item.id), this.busy),
      ])),
    ]);
  }
}

export const extend = [new Routes().add('editorial', '/editorial', EditorialIndex).add('editorial.draft', '/editorial/:id', EditorialDraft)];

app.initializers.add('el-choco-editorial', () => {
  extendMethod(IndexSidebar.prototype, 'navItems', function (items) {
    if (app.forum.attribute('canUseEditorial')) {
      items.add('editorial', m(LinkButton, { href: app.route('editorial'), icon: 'fas fa-pen-nib' }, 'Editorial'), -9);
    }
  });
});
