class InsightAggregator {

  merge(results) {

    const topics = new Set();
    const insights = new Set();
    const questions = [];
    const decisions = [];
    const actions = [];

    for (let r of results) {

      r.analysis.topics?.forEach(t => topics.add(t));
      r.analysis.insights?.forEach(i => insights.add(i));

      questions.push(...(r.analysis.questions || []));
      decisions.push(...(r.analysis.decisions || []));
      actions.push(...(r.analysis.action_items || []));

    }

    return {
      topics: [...topics],
      insights: [...insights],
      questions,
      decisions,
      actionItems: actions
    };

  }

}

export default new InsightAggregator();