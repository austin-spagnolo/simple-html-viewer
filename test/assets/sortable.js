(() => {
  const table = document.querySelector('[data-sortable-table]');
  if (!table) {
    return;
  }

  const getCellValue = (row, columnIndex) =>
    row.children[columnIndex]?.textContent?.trim() ?? '';

  const sortByColumn = (columnIndex) => {
    const body = table.tBodies[0];
    const rows = [...body.rows];
    const nextDirection =
      table.dataset.sortDirection === 'asc' ? 'desc' : 'asc';

    rows.sort((left, right) => {
      const leftValue = getCellValue(left, columnIndex);
      const rightValue = getCellValue(right, columnIndex);
      return nextDirection === 'asc'
        ? leftValue.localeCompare(rightValue, undefined, { numeric: true })
        : rightValue.localeCompare(leftValue, undefined, { numeric: true });
    });

    body.replaceChildren(...rows);
    table.dataset.sortDirection = nextDirection;
  };

  for (const button of table.querySelectorAll('[data-sort-column]')) {
    button.addEventListener('click', () => {
      sortByColumn(Number(button.getAttribute('data-sort-column')));
    });
  }
})();
