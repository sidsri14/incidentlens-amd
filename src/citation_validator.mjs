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

    // Validate coverage at the claim level instead of accepting a response just
    // because it contains one valid citation somewhere. Headings and blank
    // lines are presentation, while each prose sentence or numbered step is a
    // claim that must carry at least one known event ID.
    const claimUnits = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^#{1,6}\s+/.test(line))
      .map((line) => line.replace(/^(?:[-*]\s+|\d+\.\s+)/, ''))
      .flatMap((line) => line.split(/(?<=[.!?])\s+(?=(?:\d+\.\s*)?[A-Z])/))
      .map((claim) => claim.trim())
      .filter(Boolean);

    const uncitedClaims = claimUnits.filter((claim) => {
      const citations = [...claim.matchAll(citationRegex)].map((match) => match[1]);
      return citations.length === 0 || !citations.some((id) => validEventIds.has(id));
    });

    // Word count for density calculation
    const words = content.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const citationDensity = wordCount > 0 ? (extractedCitations.length / wordCount) * 100 : 0;

    const hasCitations = extractedCitations.length > 0;
    const hasZeroHallucinations = uniqueInvalid.length === 0;

    const isValid = hasCitations && hasZeroHallucinations && uncitedClaims.length === 0;

    let failureReason = null;
    if (!hasCitations) {
      failureReason = 'Model output contains zero event citations [EVT-XXX]; uncited claims rejected';
    } else if (!hasZeroHallucinations) {
      failureReason = `Model hallucinated non-existent event IDs: ${uniqueInvalid.join(', ')}`;
    } else if (uncitedClaims.length > 0) {
      failureReason = `Model output contains ${uncitedClaims.length} uncited claim(s)`;
    }

    return {
      valid: isValid,
      failureReason,
      totalCitations: extractedCitations.length,
      uniqueValidCitations: uniqueValid,
      invalidCitations: uniqueInvalid,
      claimCount: claimUnits.length,
      uncitedClaims,
      wordCount,
      citationDensity: parseFloat(citationDensity.toFixed(2)),
    };
  }
}
