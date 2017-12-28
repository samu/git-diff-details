const GitDiffDetailsView = require("./git-diff-details-view")

module.exports = {
  activate() {
    this.views = new WeakMap()
    atom.workspace.observeTextEditors(editor => {
      this.views.set(editor, new GitDiffDetailsView(editor))
    })
  },
  deactivate() {
    atom.workspace.getTextEditors().forEach(editor => {
      if (this.views.has(editor)) {
        this.views.get(editor).destroy()
        this.views.delete(editor)
      }
    })
  },
}
