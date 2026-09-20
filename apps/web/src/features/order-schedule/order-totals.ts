/** `1 blind`, `14 blinds` */
export const blindCount = (count: number) =>
  `${count} ${count === 1 ? 'blind' : 'blinds'}`;
