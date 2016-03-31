{View} = require 'atom-space-pen-views'
{Range, Point} = require 'atom'
_ = require 'underscore-plus'
DiffDetailsDataManager = require './data-manager'
Housekeeping = require './housekeeping'

module.exports = class AtomGitDiffDetailsView extends View
  Housekeeping.includeInto(this)

  @content: ->
    @div class: "git-diff-details-outer", =>
      @div class: "git-diff-details-main-panel", outlet: "mainPanel", =>
        @div class: "editor git-diff-editor", outlet: "contents"

  initialize: (@editor) ->
    @editorView = atom.views.getView(@editor)

    @initializeHousekeeping()
    @preventFocusOut()

    @diffDetailsDataManager = new DiffDetailsDataManager()

    @showDiffDetails = false
    @lineDiffDetails = null

    @updateCurrentRow()

  preventFocusOut: ->
    @mainPanel.on 'mousedown', () ->
      false

  getActiveTextEditor: ->
    atom.workspace.getActiveTextEditor()

  updateCurrentRow: ->
    newCurrentRow = @getActiveTextEditor()?.getCursorBufferPosition()?.row + 1
    if newCurrentRow != @currentRow
      @currentRow = newCurrentRow
      return true
    return false

  notifyContentsModified: =>
    return if @editor.isDestroyed()
    @diffDetailsDataManager.invalidate(@repositoryForPath(@editor.getPath()),
                                       @editor.getPath(),
                                       @editor.getText())
    if @showDiffDetails
      @updateDiffDetailsDisplay()

  updateDiffDetails: ->
    @diffDetailsDataManager.invalidatePreviousSelectedHunk()
    @updateCurrentRow()
    @updateDiffDetailsDisplay()

  toggleShowDiffDetails: ->
    @showDiffDetails = !@showDiffDetails
    @updateDiffDetails()

  closeDiffDetails: ->
    @showDiffDetails = false
    @updateDiffDetails()

  notifyChangeCursorPosition: ->
    if @showDiffDetails
      currentRowChanged = @updateCurrentRow()
      @updateDiffDetailsDisplay() if currentRowChanged

  copy: ->
    {selectedHunk} = @diffDetailsDataManager.getSelectedHunk(@currentRow)
    if selectedHunk?
      atom.clipboard.write(selectedHunk.oldString)
      @closeDiffDetails() if atom.config.get('git-diff-details.closeAfterCopy')

  undo: ->
    {selectedHunk} = @diffDetailsDataManager.getSelectedHunk(@currentRow)

    if selectedHunk? and buffer = @editor.getBuffer()
      if selectedHunk.kind is "m"
        buffer.setTextInRange([[selectedHunk.start - 1, 0], [selectedHunk.end, 0]], selectedHunk.oldString)
      else
        buffer.insert([selectedHunk.start, 0], selectedHunk.oldString)
      @closeDiffDetails() unless atom.config.get('git-diff-details.keepViewToggled')

  destroyDecoration: ->
    @oldLinesMarker?.destroy()
    @oldLinesMarker = null
    @newLinesMarker?.destroy()
    @newLinesMarker = null

  attach: (selectedHunk) ->
    @destroyDecoration()
    range = new Range(new Point(selectedHunk.end - 1, 0), new Point(selectedHunk.end - 1, 0))
    @oldLinesMarker = @editor.markBufferRange(range)
    @editor.decorateMarker @oldLinesMarker,
      type: 'block'
      position: 'after'
      item: this

    unless selectedHunk.kind is "d"
      range = new Range(new Point(selectedHunk.start - 1, 0), new Point(selectedHunk.end, 0))
      @newLinesMarker = @editor.markBufferRange(range)
      @editor.decorateMarker(@newLinesMarker, type: 'line', class: "git-diff-details-new")

  populate: (selectedHunk) ->
    tabLength = @getActiveTextEditor()?.getTabLength() ? atom.config.get('editor.tabLength')
    html = _.escape(selectedHunk.oldString).split(/\r\n?|\n/g)
                                           .map((line) -> line.replace(/\t/g, '&nbsp;'.repeat(tabLength)))
                                           .map((line) -> line.replace(/\s/g, '&nbsp;'))
                                           .map((line) -> "<div class='line git-diff-details-old'>#{line}</div>")
    @contents.html(html)

  updateDiffDetailsDisplay: ->
    if @showDiffDetails
      {selectedHunk, isDifferent} = @diffDetailsDataManager.getSelectedHunk(@currentRow)

      if selectedHunk?
        return unless isDifferent
        @attach(selectedHunk)
        @populate(selectedHunk)
        return
      else
        @closeDiffDetails() unless atom.config.get('git-diff-details.keepViewToggled')

      @previousSelectedHunk = selectedHunk

    @destroyDecoration()
    return
