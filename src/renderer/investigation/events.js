// Timeline records are append-only in the UI. IDs allow later phases to link evidence.
export function createEvent(
  input,
  existing,
  config,
  { author, code, language, issue },
  now = Date.now(),
) {
  if (!config.eventTypes.includes(input.type))
    throw new Error('Choose a valid event type.');
  for (const field of config.fields) {
    const value = input[field.key];
    if (
      typeof value !== 'string' ||
      value.length > field.maxLength ||
      (field.required && !value.trim())
    )
      throw new Error(`Check ${field.label}.`);
  }
  const target = existing.find((event) => event.id === input.parentId);
  if (input.parentId && !target)
    throw new Error('The linked event no longer exists.');
  if (
    input.type === 'outcome' &&
    (!target || !['hypothesis', 'experiment'].includes(target.type))
  )
    throw new Error('Link this outcome to a hypothesis or experiment.');
  if (input.output && !['experiment', 'outcome'].includes(input.type))
    throw new Error('Attach output to an experiment or outcome.');
  if (input.type === 'outcome' && !config.outcomes.includes(input.outcome))
    throw new Error('Choose an outcome.');
  if (input.type === 'checkpoint' && code.length > config.maxSnapshotLength)
    throw new Error(
      'The code is too large for a checkpoint. Shorten the shared document first.',
    );
  const event = {
    id: crypto.randomUUID(),
    type: input.type,
    title: input.title.trim(),
    notes: input.notes,
    output: input.output,
    parentId: input.parentId || null,
    author: String(author).slice(0, 60),
    createdAt: now,
    issue: String(issue || '').slice(0, 12000),
    ...(input.type === 'outcome' ? { outcome: input.outcome } : {}),
    ...(input.type === 'checkpoint' ? { code, language } : {}),
  };
  validateAppend(existing, event, config);
  return event;
}

export function validateAppend(existing, event, config) {
  if (existing.length >= config.maxEvents)
    throw new Error('Timeline entry limit reached.');
  if (
    new TextEncoder().encode(JSON.stringify([...existing, event])).byteLength >
    config.maxBytes
  )
    throw new Error('Timeline is too large. Reduce output or checkpoint size.');
  if (existing.some((item) => item.id === event.id))
    throw new Error('This entry has already been shared.');
  if (event.parentId && !existing.some((item) => item.id === event.parentId))
    throw new Error('The linked event no longer exists.');
}

export function eventSummary(event) {
  return [
    `${event.type}: ${event.title}`,
    `${event.author} · ${new Date(event.createdAt).toLocaleString()}`,
    event.parentId ? `Linked event: ${event.parentId}` : '',
    event.outcome ? `Participant-reported outcome: ${event.outcome}` : '',
    event.notes,
    event.output ? `Manually supplied output\n${event.output}` : '',
    typeof event.code === 'string'
      ? `Checkpoint (${event.language})\n\n${event.code}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function catchUp(events, currentIssue, attempts = []) {
  const outcomes = new Map();
  for (const event of events)
    if (event.type === 'outcome') outcomes.set(event.parentId, event);
  const investigations = events.filter((event) =>
    ['hypothesis', 'experiment'].includes(event.type),
  );
  const completed = investigations.filter(
    (event) =>
      outcomes.has(event.id) && outcomes.get(event.id).outcome !== 'pending',
  );
  const open = investigations.filter(
    (event) =>
      !outcomes.has(event.id) ||
      ['pending', 'inconclusive'].includes(outcomes.get(event.id).outcome),
  );
  return [
    `Issue at first timeline entry\n${events[0]?.issue || currentIssue || 'No issue recorded yet.'}`,
    `Previous attempts\n${attempts.map((attempt) => `${attempt.action}: ${attempt.outcome}${attempt.notes ? ` — ${attempt.notes}` : ''}`).join('\n') || 'None recorded.'}`,
    `Reported results\n${completed.map((event) => `${event.title}: ${outcomes.get(event.id).outcome} — ${outcomes.get(event.id).notes}`).join('\n') || 'None recorded.'}`,
    `Open hypotheses / experiments\n${open.map((event) => `${event.title}${event.notes ? ` — ${event.notes}` : ''}`).join('\n') || 'None recorded.'}`,
  ].join('\n\n');
}
