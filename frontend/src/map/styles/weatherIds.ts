export const getWeatherSourceId = (layerName: string, hour: string) => `weather_${layerName}_t${hour}`
export const getWeatherLayerId = (layerName: string, hour: string) => `weather-${layerName}-t${hour}-layer`
