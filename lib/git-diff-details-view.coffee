{View} = require 'atom-space-pen-views'
{Range, Point, CompositeDisposable} = require 'atom'
Highlights = require 'highlights'
DiffDetailsDataManager = require './data-manager'

module.exports = class AtomGitDiffDetailsView extends View
  @content: ->
    @div class: "git-diff-details-outer", =>
      @div class: "git-diff-details-main-panel", outlet: "mainPanel", =>
        @div class: "editor git-diff-editor", outlet: "contents"
      @div class: "git-diff-details-button-panel", outlet: "buttonPanel", =>
        @button class: 'btn btn-primary inline-block-tight', click: "copy", 'Copy'
        @button class: 'btn btn-error inline-block-tight', click: "undo", 'Undo'

  initialize: (@editor) ->
    console.log 'initializing'
    @lineDiffDetails = null
    @showDiffDetails = false
    @highlighter = new Highlights()
    @diffDetailsDataManager = new DiffDetailsDataManager()

    @subscriptions = new CompositeDisposable()
    @subscriptions.add @editor.onDidDestroy =>
      @cancelUpdate()
      @destroyDecoration()
      @subscriptions.dispose()

    @subscribeToRepository()
    @subscriptions.add(@editor.onDidStopChanging(@notifyContentsModified.bind(this)))
    @subscriptions.add(@editor.onDidChangePath(@notifyContentsModified.bind(this)))
    @subscriptions.add(@editor.onDidChangeCursorPosition(@notifyChangeCursorPosition.bind(this)))
    @subscriptions.add atom.project.onDidChangePaths, @subscribeToRepository.bind(this)
    @subscriptions.add atom.commands.add 'atom-text-editor',
      'core:close': (e) => @closePanel()
      'core:cancel': (e) => @closePanel()
      'git-diff-details:copy': (e) => @copy()
      'git-diff-details:undo': (e) => @undo()
      'git-diff-details:close': (e) => @closePanel()
      'git-diff-details:toggle': (e) => @togglePanel()

    @scheduleUpdate()
    @preventFocusOut()
    @checkIfEditorRowChanged()

  #------------------------
  #   event handing code
  #------------------------
  notifyContentsModified: ->
    return if @editor.isDestroyed()
    @currentRepository().then (repo) =>
      return unless repo?
      @diffDetailsDataManager.invalidate(repo,
                                         @editor.getPath(),
                                         @editor.getText())
    if @showDiffDetails
      @updateDiffDetailsDisplay()

  togglePanel: ->
    @showDiffDetails = !@showDiffDetails
    @updateDiffDetails()

  closePanel: ->
    if @showDiffDetails
      @showDiffDetails = false
      @updateDiffDetails()

  notifyChangeCursorPosition: ->
    if @showDiffDetails
      currentRowChanged = @checkIfEditorRowChanged()
      @updateDiffDetailsDisplay() if currentRowChanged

  copy: ->
    return if !@showDiffDetails
    {selectedHunk} = @diffDetailsDataManager.getSelectedHunk(@currentRow)
    if selectedHunk?
      atom.clipboard.write(selectedHunk.oldString)
      @closePanel() if atom.config.get('git-diff-details.closeAfterCopy')

  undo: ->
    return if !@showDiffDetails
    {selectedHunk} = @diffDetailsDataManager.getSelectedHunk(@currentRow)

    if selectedHunk? and buffer = @editor.getBuffer()
      if selectedHunk.kind is "m"
        buffer.deleteRows(selectedHunk.start - 1, selectedHunk.end - 1)
        buffer.insert([selectedHunk.start - 1, 0], selectedHunk.oldString)
      else
        buffer.insert([selectedHunk.start, 0], selectedHunk.oldString)
      @closePanel() unless atom.config.get('git-diff-details.keepViewToggled')

  #----------------------
  #   UI display
  #----------------------
  preventFocusOut: ->
    @buttonPanel.on 'mousedown', -> false
    @mainPanel.on 'mousedown', -> false

  updateDiffDetails: ->
    return unless @isRepositoryAtCurrentPath
    @diffDetailsDataManager.invalidatePreviousSelectedHunk()
    @checkIfEditorRowChanged()
    @updateDiffDetailsDisplay()

  destroyDecoration: ->
    @marker?.destroy()
    @marker = null

  attach: (position) ->
    @destroyDecoration()
    range = new Range(new Point(position - 1, 0), new Point(position - 1, 0))
    @marker = @editor.markBufferRange(range)
    @editor.decorateMarker @marker,
      type: 'overlay'
      item: this

  populate: (selectedHunk) ->
    html = @highlighter.highlightSync
      filePath: @editor.getPath()
      fileContents: selectedHunk.oldString

    html = html.replace('<pre class="editor editor-colors">', '').replace('</pre>', '')
    @contents.html(html)

  updateDiffDetailsDisplay: ->
    if !@showDiffDetails
      @destroyDecoration()
      return

    {selectedHunk, isDifferent} = @diffDetailsDataManager.getSelectedHunk(@currentRow)
    if selectedHunk?
      return unless isDifferent
      @attach(selectedHunk.end)
      @populate(selectedHunk)
    else
      @closePanel() unless atom.config.get('git-diff-details.keepViewToggled')
      @destroyDecoration

  #----------------------
  #   helpers
  #----------------------
  cancelUpdate: ->
    clearImmediate(@immediateId)

  scheduleUpdate: ->
    @cancelUpdate()
    @immediateId = setImmediate(=> @notifyContentsModified())

  currentRepository: ->
    @repositoryForPath(@editor.getPath())

  repositoryForPath: (goalPath) ->
    for directory in atom.project.getDirectories()
      if goalPath is directory.getPath() or directory.contains(goalPath)
        return atom.project.repositoryForDirectory(directory)
    return new Promise (resolve, reject) -> resolve undefined

  subscribeToRepository: ->
    @isRepositoryAtCurrentPath = false
    @currentRepository().then (repository) =>
      if repository
        @isRepositoryAtCurrentPath = true
        @subscriptions.add repository.onDidChangeStatuses, => @scheduleUpdate()
        @subscriptions.add repository.onDidChangeStatus, (changedPath) =>
          @scheduleUpdate() if changedPath is @editor.getPath()

  getActiveTextEditor: ->
    atom.workspace.getActiveTextEditor()

  checkIfEditorRowChanged: ->
    newCurrentRow = @getActiveTextEditor()?.getCursorBufferPosition()?.row + 1
    if newCurrentRow != @currentRow
      @currentRow = newCurrentRow
      return true
    return false
