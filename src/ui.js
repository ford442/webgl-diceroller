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
    container.style.zIndex = '1000'; // Ensure it's above canvas

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

        // Prevent pointer lock when interacting with inputs
        input.addEventListener('mousedown', (e) => e.stopPropagation());

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
    // Prevent pointer lock when clicking button
    rollBtn.addEventListener('mousedown', (e) => e.stopPropagation());


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

export const createCrosshair = () => {
    const crosshair = document.createElement('div');
    crosshair.style.position = 'absolute';
    crosshair.style.width = '20px';
    crosshair.style.height = '20px';
    crosshair.style.pointerEvents = 'none'; // Click through
    crosshair.style.zIndex = '999';
    crosshair.style.transform = 'translate(-50%, -50%)'; // Center pivot

    // Simple visual: a white circle with a dot
    const circle = document.createElement('div');
    circle.style.width = '100%';
    circle.style.height = '100%';
    circle.style.border = '2px solid rgba(255, 255, 255, 0.7)';
    circle.style.borderRadius = '50%';
    crosshair.appendChild(circle);

    const dot = document.createElement('div');
    dot.style.position = 'absolute';
    dot.style.top = '50%';
    dot.style.left = '50%';
    dot.style.width = '4px';
    dot.style.height = '4px';
    dot.style.backgroundColor = 'white';
    dot.style.borderRadius = '50%';
    dot.style.transform = 'translate(-50%, -50%)';
    crosshair.appendChild(dot);

    document.body.appendChild(crosshair);

    return {
        updatePosition: (x, y) => {
            crosshair.style.left = `${x}px`;
            crosshair.style.top = `${y}px`;
        },
        setVisible: (visible) => {
            crosshair.style.display = visible ? 'block' : 'none';
        }
    };
};
