import { selectArrowOption } from "./prompts";
import type { InstallMode } from "./constants";

const MODE_OPTIONS = [
  { label: "Аналитик/разработчик", value: "analyst-developer" as const },
  { label: "Эксперт УЭК", value: "uek-expert" as const },
];

export async function selectInstallMode(
  nonInteractive: boolean,
  override?: InstallMode,
): Promise<InstallMode> {
  if (override) {
    console.log(`Выбран режим установки: ${override}`);
    return override;
  }
  if (nonInteractive) {
    return "analyst-developer";
  }
  const value = await selectArrowOption(
    "В каком режиме установить доску sdd?",
    0,
    MODE_OPTIONS,
  );
  console.log(`Выбран режим установки: ${value}`);
  return value as InstallMode;
}