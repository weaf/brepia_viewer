import React from 'react';
import { Parameter } from '@shared/types';
import { Slider } from '@/components/ui/slider';
import {
  calculateParameterRange,
  calculateParameterStep,
  validateParameterValue,
} from '@/utils/parameterUtils';

interface ParameterSliderProps {
  param: Parameter;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  step?: number;
}

function ParameterSliderBase({
  param,
  onValueChange,
  onValueCommit,
  step,
}: ParameterSliderProps) {
  const { min, max } = calculateParameterRange(param);
  const calculatedStep = Number.isFinite(step) && step! > 0
    ? step! : calculateParameterStep(param);
  const sliderValue = Number(validateParameterValue(param, param.value));
  const defaultValue = Number(validateParameterValue(param, param.defaultValue));

  return (
    <Slider
      id={`${param.name}-slider`}
      name={param.name}
      className="w-full"
      defaultMarkerStyle="line"
      onValueChange={([newValue]) => {
        if (Number.isFinite(newValue)) onValueChange(newValue);
      }}
      onValueCommit={([newValue]) => {
        if (!Number.isFinite(newValue)) return;
        onValueCommit(newValue);
        onValueChange(newValue);
      }}
      min={min}
      max={max}
      value={[sliderValue]}
      defaultValue={[defaultValue]}
      step={calculatedStep}
    />
  );
}

export const ParameterSlider = React.memo(ParameterSliderBase);
