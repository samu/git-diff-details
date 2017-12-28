const {View} = require("atom-space-pen-views")
const {Range, CompositeDisposable, TextEditor} = require("atom")
const {decorateRange, getLineDiffDetails, repositoryForPath} = require("./utils")

const getConfig = param => atom.config.get(`git-diff-details.${param}`)
const nullGrammar = atom.grammars.grammarForScopeName("text.plain.null-grammar")

class DiffView extends View {
  static content() {
    return this.div({class: "git-diff-details-outer"}, () => {
      return this.div({class: "git-diff-details-main-panel", outlet: "mainPanel"}, () => {
        return this.div({class: "editor git-diff-editor", outlet: "contents"})
      })
    })
  }

  initialize(grammar, hunk) {
    this.editor = new TextEditor({lineNumberGutterVisible: false, scrollPastEnd: false})
    this.editor.setGrammar(grammar)
    this.editor.setText(hunk.oldString.replace(/[\r\n]+$/g, ""))
    this.contents.html(this.editor.element)
  }

  destroy() {
    this.editor.destroy()
  }
}

module.exports = class GitDiffDetailsView extends View {
  static content() {
    return this.div({class: "git-diff-details-outer"}, () => {
      return this.div({class: "git-diff-details-main-panel", outlet: "mainPanel"}, () => {
        return this.div({class: "editor git-diff-editor", outlet: "contents"})
      })
    })
  }

  initialize(editor) {
    this.editor = editor
    this.showDiffDetails = false

    this.disposables = new CompositeDisposable(this.editor.onDidDestroy(() => this.destroy()))

    const repository = repositoryForPath(this.editor.getPath())
    if (repository) {
      this.subscribeToRepository()

      this.disposables.add(
        this.editor.onDidStopChanging(() => this.refreshDiff()),
        this.editor.onDidChangePath(() => this.refreshDiff()),
        this.editor.onDidChangeCursorPosition(event => {
          if (getConfig("showAllChanges")) return
          if (this.showDiffDetails && event.oldBufferPosition.row !== event.newBufferPosition.row) {
            this.showDiff()
          }
        }),
        atom.project.onDidChangePaths(() => this.subscribeToRepository()),
        atom.commands.add(this.editor.element, {
          "git-diff-details:toggle-git-diff-details": () => this.toggleDiff(),
          "core:close": () => this.hideDiff(),
          "core:cancel": () => this.hideDiff(),
          "git-diff-details:undo": () => this.undo(),
          "git-diff-details:copy": () => this.copy(),
        })
      )
    }

    this.mainPanel.on("mousedown", () => false) // avoid focus taken by embedded diffEditor
    this.disposables.add(
      atom.config.observe("git-diff-details.useFlatColorForAddedLines", enabled => {
        this.editor.element.classList.toggle("use-flat-color-for-added-lines", enabled)
      })
    )
    this.markers = []
    this.diffEditors = []
  }

  destroy() {
    if (this.repositoryDisposables) this.repositoryDisposables.dispose()
    clearImmediate(this.immediateId)
    this.destroyDecorations()
    this.disposables.dispose()
  }

  getHunkAtCursorRow() {
    const line = this.editor.getCursorBufferPosition().row + 1
    return this.getHunks().find(hunk => hunk.start <= line && line <= hunk.end)
  }

  getHunks() {
    if (!this.lineDiffDetails) this.lineDiffDetails = getLineDiffDetails(this.editor)
    return this.lineDiffDetails
  }

  refreshDiff() {
    this.lineDiffDetails = null
    if (this.editor.isAlive() && this.showDiffDetails) this.showDiff()
  }

  copy() {
    if (!this.showDiffDetails) return
    const hunk = this.getHunkAtCursorRow()
    if (hunk) {
      atom.clipboard.write(hunk.oldString)
      if (getConfig("closeAfterCopy")) this.hideDiff()
    }
  }

  undo() {
    if (!this.showDiffDetails) return
    const hunk = this.getHunkAtCursorRow()
    if (hunk) {
      const {kind, start, end, oldString} = hunk
      const rangeToSetText = kind === "m" ? [[start - 1, 0], [end, 0]] : [[start, 0], [start, 0]]
      this.editor.setTextInBufferRange(rangeToSetText, oldString)
      if (!getConfig("keepViewToggled")) this.hideDiff()
    }
  }

  destroyDecorations() {
    this.markers.forEach(marker => marker.destroy())
    this.diffEditors.forEach(diffEditor => diffEditor.destroy())
    this.diffEditors = []
    this.markers = []
  }

  decorateRange(...args) {
    this.markers.push(decorateRange(...args))
  }

  decorateLines(editor, start, end, className) {
    this.decorateRange(editor, [[start, 0], [end, 0]], {type: "line", class: className})
  }

  decorateWords(editor, start, words, className) {
    if (!words) return

    const decorationOptions = {type: "highlight", class: className}
    for (const word of words.filter(word => word.changed)) {
      const row = start + word.offsetRow
      this.decorateRange(editor, [[row, word.startCol], [row, word.endCol]], decorationOptions)
    }
  }

  display(hunk) {
    this.displayedHunk = hunk

    // host editor
    {
      const className = "git-diff-details-added"
      this.decorateLines(this.editor, hunk.start - 1, hunk.end, className)
      if (hunk.kind === "m") {
        if (getConfig("showWordDiffs")) this.decorateWords(this.editor, hunk.start - 1, hunk.newWords, className)
      }
    }

    // embedded diff-editor
    const grammar = getConfig("useFlatColorForRemovedLines") ? nullGrammar : this.editor.getGrammar()
    const diffView = new DiffView(grammar, hunk)
    this.diffEditors.push(diffView)
    if (getConfig("showWordDiffs")) {
      this.decorateWords(diffView.editor, 0, hunk.oldWords, "git-diff-details-removed")
    }

    // embeded diffEditor to host-editor as block-decoration
    const point = [hunk.end - 1, 0]
    this.decorateRange(this.editor, [point, point], {type: "block", position: "after", item: diffView})
  }

  async showDiff() {
    if (getConfig("showAllChanges")) {
      this.withKeepingRelativeScrollPosition(() => {
        this.destroyDecorations()
        this.getHunks().forEach(hunk => this.display(hunk))
      })
    } else {
      const hunk = this.getHunkAtCursorRow()
      if (hunk) {
        if (this.displayedHunk !== hunk) {
          this.destroyDecorations()
          this.display(hunk)
        }
      } else {
        this.hideDiff(getConfig("keepViewToggled"))
      }
    }
  }

  pixelPositionForBufferPosition(point) {
    return this.editor.element.pixelPositionForBufferPosition(point)
  }

  async withKeepingRelativeScrollPosition(fn) {
    const cursorPosition = this.editor.getCursorBufferPosition()
    const oldPixelTop = this.pixelPositionForBufferPosition(cursorPosition).top
    await fn()
    await this.editor.component.getNextUpdatePromise()
    const newPixelTop = this.pixelPositionForBufferPosition(cursorPosition).top
    const amountOfScrolledPixels = newPixelTop - oldPixelTop
    if (amountOfScrolledPixels) {
      this.editor.element.setScrollTop(this.editor.element.getScrollTop() + amountOfScrolledPixels)
      this.editor.component.updateSync()
    }
  }

  hideDiff(once) {
    this.withKeepingRelativeScrollPosition(() => {
      if (!once) this.showDiffDetails = false
      this.displayedHunk = null
      this.destroyDecorations()
    })
  }

  toggleDiff() {
    this.showDiffDetails = !this.showDiffDetails
    if (this.showDiffDetails) {
      this.showDiff()
    } else {
      this.hideDiff()
    }
  }

  subscribeToRepository() {
    if (this.repositoryDisposables) {
      this.repositoryDisposables.dispose()
      this.repositoryDisposables = null
    }
    const repository = repositoryForPath(this.editor.getPath())
    if (repository) {
      this.repositoryDisposables = new CompositeDisposable(
        repository.onDidChangeStatuses(() => this.scheduleUpdate()),
        repository.onDidChangeStatus(changedPath => {
          if (changedPath === this.editor.getPath()) this.scheduleUpdate()
        })
      )
    }
  }

  scheduleUpdate() {
    clearImmediate(this.immediateId)
    this.immediateId = setImmediate(() => this.refreshDiff())
  }
}
