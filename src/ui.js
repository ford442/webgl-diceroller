export const initUI = (onUpdateDice, onRollAll) => {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '10px';
    container.style.right = '10px';
    container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    container.style.padding = '10px';
    container.style.color = 'white';
    container.style.fontFamily = 'sans-serif';
    container.style.borderRadius = '5px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '5px';

    const diceTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    const inputs = {};

    // Initial counts (matching the default single die of each type)
    const counts = { d4: 1, d6: 1, d8: 1, d10: 1, d12: 1, d20: 1 };

    diceTypes.forEach(type => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';

        const label = document.createElement('label');
        label.textContent = type.toUpperCase() + ': ';
        label.style.marginRight = '10px';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '10';
        input.value = counts[type];
        input.style.width = '40px';
        input.style.marginLeft = '5px';

        input.addEventListener('change', () => {
            counts[type] = parseInt(input.value) || 0;
            onUpdateDice(counts);
        });

        inputs[type] = input;

        row.appendChild(label);
        row.appendChild(input);
        container.appendChild(row);
    });

    const rollBtn = document.createElement('button');
    rollBtn.textContent = 'Roll All';
    rollBtn.style.marginTop = '10px';
    rollBtn.style.cursor = 'pointer';
    rollBtn.addEventListener('click', () => {
        onRollAll();
    });

    container.appendChild(rollBtn);
    document.body.appendChild(container);

    return {
        updateCounts: (newCounts) => {
            Object.keys(newCounts).forEach(key => {
                if (inputs[key]) {
                    inputs[key].value = newCounts[key];
                    counts[key] = newCounts[key];
                }
            });
        }
    };
};
