import type { ComponentType } from 'react';
import type { WidgetComponentProps } from './types';
import { ClockWidget } from './ClockWidget';
import { CalendarWidget } from './CalendarWidget';
import { NetworkWidget } from './NetworkWidget';
import { NotesWidget } from './NotesWidget';
import { SensorWidget } from './SensorWidget';
import { SystemWidget } from './SystemWidget';
import { CurrentWeatherWidget, ForecastWeatherWidget, HourlyWeatherWidget } from './WeatherWidget';

const registry: Record<string, ComponentType<WidgetComponentProps>> = {
  clock: ClockWidget,
  notes: NotesWidget,
  system: SystemWidget,
  'weather.current': CurrentWeatherWidget,
  'weather.forecast': ForecastWeatherWidget,
  'weather.hourly': HourlyWeatherWidget,
  'sensor.temperature': SensorWidget,
  network: NetworkWidget,
  calendar: CalendarWidget,
};

export function WidgetRenderer(props: WidgetComponentProps) {
  const Component = registry[props.instance.widgetId];
  if (!Component)
    return <div className="widget-error">Widget « {props.instance.widgetId} » non installé.</div>;
  return <Component {...props} />;
}
