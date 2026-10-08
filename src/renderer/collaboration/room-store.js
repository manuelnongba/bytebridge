// Invalid browser storage must not prevent the workspace from opening.
// Leave the original value untouched until the user saves a room.
export function readSavedRooms(storage) {
  try {
    const rooms = JSON.parse(storage.getItem('bytebridge-rooms') || '[]');
    if (!Array.isArray(rooms)) return [];
    return rooms.filter(
      (room) =>
        room &&
        ['id', 'server', 'token'].every(
          (key) => typeof room[key] === 'string' && room[key].length > 0,
        ),
    );
  } catch {
    return [];
  }
}

export function sameRoom(a, b) {
  return !!a && !!b && a.id === b.id && a.server === b.server;
}

// Apply to every credential saved for this room on this profile.
export function manageSavedRooms(rooms, room, action, value) {
  if (action === 'forget') return rooms.filter((item) => !sameRoom(item, room));
  if (!['archive', 'rename'].includes(action))
    throw new Error('Unknown room action');
  return rooms.map((item) =>
    !sameRoom(item, room)
      ? item
      : {
          ...item,
          ...(action === 'archive' ? { archived: !!value } : { title: value }),
        },
  );
}
