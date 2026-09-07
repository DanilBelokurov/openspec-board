"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectInstallMode = selectInstallMode;
const prompts_1 = require("./prompts");
const MODE_OPTIONS = [
    { label: "Аналитик/разработчик", value: "analyst-developer" },
    { label: "Эксперт УЭК", value: "uek-expert" },
];
async function selectInstallMode(nonInteractive, override) {
    if (override) {
        console.log(`Выбран режим установки: ${override}`);
        return override;
    }
    if (nonInteractive) {
        return "analyst-developer";
    }
    const value = await (0, prompts_1.selectArrowOption)("В каком режиме установить доску sdd?", 0, MODE_OPTIONS);
    console.log(`Выбран режим установки: ${value}`);
    return value;
}
