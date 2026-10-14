/**
 * Citation verification engine for IncidentLens AMD.
 * Validates that all model claims cite real, verified trace event IDs.
 */

export class CitationValidator {
  /**
   * Validate citations in model response against valid event IDs.
   * @param {string} content Model text response
   * @param {Set<string>} validEventIds Set of valid event IDs from EvidenceMatrix
   * @returns {Object} Validation verdict and citation analytics
   */
  validate(content, validEventIds) {
    if (typeof content !== 'string') {
      throw new TypeError('content must be a string');
    }
    if (!(validEventIds instanceof Set)) {
      throw new TypeError('validEventIds must be a Set of strings');
    }

    const citationRegex = /\[(EVT-\d{3,4})\]/g;
    const matches = [...content.matchAll(citationRegex)];
    const extractedCitations = matches.map((m) => m[1]);

    const validCitations = [];
    const invalidCitations = [];

    for (const id of extractedCitations) {
      if (validEventIds.has(id)) {
        validCitations.push(id);
      } else {
        invalidCitations.push(id);
      }
    }

    const uniqueValid = [...new Set(validCitations)];
    const uniqueInvalid = [...new Set(invalidCitations)];

    // Word count for density calculation
    const words = content.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const citationDensity = wordCount > 0 ? (extractedCitations.length / wordCount) * 100 : 0;

    const hasCitations = extractedCitations.length > 0;
    const hasZeroHallucinations = uniqueInvalid.length === 0;

    const isValid = hasCitations && hasZeroHallucinations;

    let failureReason = null;
    if (!hasCitations) {
      failureReason = 'Model output contains zero event citations [EVT-XXX]; uncited claims rejected';
    } else if (!hasZeroHallucinations) {
      failureReason = `Model hallucinated non-existent event IDs: ${uniqueInvalid.join(', ')}`;
    }

    return {
      valid: isValid,
      failureReason,
      totalCitations: extractedCitations.length,
      uniqueValidCitations: uniqueValid,
      invalidCitations: uniqueInvalid,
      wordCount,
      citationDensity: parseFloat(citationDensity.toFixed(2)),
    };
  }
}
