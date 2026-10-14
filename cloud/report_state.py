"""Current merged overviews are separate from immutable archived updates."""
def report_overviews(state):
    if state.get('reportOverviews'):
        return state['reportOverviews']
    latest = {}
    for event in state.get('events', []):
        if event.get('cumulative') and (event['day'] not in latest or event['at'] > latest[event['day']]['at']):
            latest[event['day']] = event
    return list(latest.values())
