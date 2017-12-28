let JsDiff

// return marker
function decorateRange(editor, range, decorationOptions) {
  const marker = editor.markBufferRange(range)
  editor.decorateMarker(marker, decorationOptions)
  return marker
}

function repositoryForPath(goalPath) {
  let i = 0
  for (const directory of atom.project.getDirectories()) {
    if (goalPath === directory.getPath() || directory.contains(goalPath)) {
      return atom.project.getRepositories()[i]
    }
    i++
  }
}

function getLineDiffDetails(editor) {
  const repo = repositoryForPath(editor.getPath()).getRepo()
  const options = {ignoreEolWhitespace: process.platform === "win32"}
  const diff = repo.getLineDiffDetails(repo.relativize(editor.getPath()), editor.getText(), options)

  const results = []
  if (!diff) return results

  let hunk
  for (let {oldStart, newStart, oldLines, newLines, oldLineNumber, newLineNumber, line} of diff) {
    // process modifications and deletions only
    if (oldLines !== 0 || !(newLines > 0)) {
      // create a new hunk entry if the hunk start of the previous line
      // is different to the current
      if (!hunk || newStart !== hunk.start) {
        let newEnd, kind
        if (newLines === 0 && oldLines > 0) {
          newEnd = newStart
          kind = "d"
        } else {
          newEnd = newStart + newLines - 1
          kind = "m"
        }

        hunk = {
          start: newStart,
          end: newEnd,
          oldLines: [],
          newLines: [],
          newString: "",
          oldString: "",
          kind,
        }
        results.push(hunk)
      }

      if (newLineNumber >= 0) {
        hunk.newLines.push(line)
        hunk.newString += line
      } else {
        hunk.oldLines.push(line)
        hunk.oldString += line
      }
    }
  }
  return annotateWordDiffs(results)
}

function annotateWordDiffs(lineDiffDetails) {
  if (!JsDiff) JsDiff = require("diff")
  for (let hunk of lineDiffDetails) {
    if (hunk.kind !== "m" || hunk.newLines.length !== hunk.oldLines.length) {
      continue
    }
    hunk.newWords = []
    hunk.oldWords = []
    for (let i = 0, end = hunk.newLines.length; i < end; i++) {
      let oldCol = 0
      let newCol = 0
      const diff = JsDiff.diffWordsWithSpace(hunk.oldLines[i], hunk.newLines[i])
      for (let word of diff) {
        word.offsetRow = i
        if (word.added) {
          word.changed = true
          word.startCol = newCol
          newCol += word.value.length
          word.endCol = newCol
          hunk.newWords.push(word)
        } else if (word.removed) {
          word.changed = true
          word.startCol = oldCol
          oldCol += word.value.length
          word.endCol = oldCol
          hunk.oldWords.push(word)
        } else {
          newCol += word.value.length
          oldCol += word.value.length
          hunk.newWords.push(word)
          hunk.oldWords.push(word)
        }
      }
    }
  }
  return lineDiffDetails
}

module.exports = {decorateRange, getLineDiffDetails, repositoryForPath}
