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

  const modifiedHunks = results.filter(hunk => hunk.kind === "m" && hunk.newLines.length === hunk.oldLines.length)
  for (let hunk of modifiedHunks) {
    hunk.oldRelativeChanges = []
    hunk.newRelativeChanges = []
    for (let i = 0, end = hunk.newLines.length; i < end; i++) {
      const [rangeA, rangeB] = getRelativeChangeRanges(hunk.oldLines[i], hunk.newLines[i])
      hunk.oldRelativeChanges.push(rangeA)
      hunk.newRelativeChanges.push(rangeB)
    }
  }
  return results
}

// Line base diff
//-------------------------
// - compare two text then split text into three parts which is prefix-range, inner-range and sufix-range.l
// - Then finally return inner-range information as {start: start of inner-range, length: length of inner-range}.
// - Now we can highlight inner-range differently to display commonarily of two string.
// Borrowed and modified from GitHub's electron based app at desktop/desktop.
// https://github.com/desktop/desktop/pull/2461
function commonLength(textA, rangeA, textB, rangeB, reverse) {
  let max = Math.min(rangeA.length, rangeB.length)
  const startA = reverse ? textA.length - 1 : rangeA.start
  const startB = reverse ? textB.length - 1 : rangeB.start
  const stride = reverse ? -1 : 1

  let length = 0
  while (max-- && textA[startA + length] === textB[startB + length]) length += stride
  return Math.abs(length)
}

function getRelativeChangeRanges(textA, textB) {
  let rangeA = {start: 0, length: textA.length}
  let rangeB = {start: 0, length: textB.length}

  const prefixLength = commonLength(textA, rangeA, textB, rangeB, false)
  rangeA = {start: prefixLength, length: textA.length - prefixLength}
  rangeB = {start: prefixLength, length: textB.length - prefixLength}

  const suffixLength = commonLength(textA, rangeA, textB, rangeB, true)
  rangeB.length -= suffixLength
  rangeA.length -= suffixLength
  return [rangeA, rangeB]
}

module.exports = {decorateRange, getLineDiffDetails, repositoryForPath}
