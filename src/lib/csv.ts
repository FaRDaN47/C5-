export function csvCell(value: string) {
  const safeValue = /^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(value)
    ? `'${value}`
    : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}
