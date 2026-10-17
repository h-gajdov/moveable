"""Estimated slopes from the Copernicus GLO-30 elevation model.

Copernicus GLO-30 is a *surface* model (DSM): it contains buildings and trees.
To approximate terrain we apply a morphological opening (removes objects smaller
than ~150 m, i.e. buildings) followed by Gaussian smoothing, then sample the
terrain gradient along each edge's direction.

The result is stored with ``incline_source = 'DEM'`` and is ONLY used as a soft
routing penalty and as a warning ("possibly steep, estimated"). It never
overrides an OSM ``incline`` tag and never acts as a hard constraint.
"""

from __future__ import annotations

import logging
import math
import os
import urllib.request

import numpy as np

log = logging.getLogger(__name__)

DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{tile}/{tile}.tif"


def download_tiles(tiles: list[str], dest_dir: str) -> list[str]:
    os.makedirs(dest_dir, exist_ok=True)
    paths = []
    for tile in tiles:
        path = os.path.join(dest_dir, f"{tile}.tif")
        if not os.path.exists(path):
            log.info("downloading DEM tile %s", tile)
            tmp = path + ".part"
            urllib.request.urlretrieve(DEM_URL.format(tile=tile), tmp)
            os.replace(tmp, path)
        paths.append(path)
    return paths


class TerrainModel:
    """Smoothed terrain gradient over a bbox, in metres per metre."""

    def __init__(self, tile_paths: list[str], bbox: tuple[float, float, float, float],
                 opening_px: int = 5, sigma_px: float = 2.0):
        import rasterio
        from rasterio.merge import merge
        from scipy import ndimage

        datasets = [rasterio.open(p) for p in tile_paths]
        pad = 0.01
        bounds = (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad)
        mosaic, transform = merge(datasets, bounds=bounds)
        for d in datasets:
            d.close()
        z = mosaic[0].astype("float64")
        z[z < -100] = np.nan
        z = np.where(np.isnan(z), np.nanmean(z), z)
        terrain = ndimage.grey_opening(z, size=(opening_px, opening_px))
        terrain = ndimage.gaussian_filter(terrain, sigma=sigma_px)

        self.transform = transform
        self.terrain = terrain
        lat_c = (bbox[1] + bbox[3]) / 2
        dx = transform.a * 111_320 * math.cos(math.radians(lat_c))  # metres per pixel (x)
        dy = -transform.e * 110_540                                  # metres per pixel (y)
        gy, gx = np.gradient(terrain)
        self.gx = gx / dx           # dz/d(east)
        self.gy = -gy / dy          # dz/d(north); raster rows grow southwards

    def _pixel(self, lon: float, lat: float) -> tuple[int, int]:
        col = int((lon - self.transform.c) / self.transform.a)
        row = int((lat - self.transform.f) / self.transform.e)
        row = min(max(row, 0), self.terrain.shape[0] - 1)
        col = min(max(col, 0), self.terrain.shape[1] - 1)
        return row, col

    def elevation(self, lon: float, lat: float) -> float:
        r, c = self._pixel(lon, lat)
        return float(self.terrain[r, c])

    def slope_along(self, coords: list[tuple[float, float]]) -> float:
        """Signed slope (%) along a polyline, in the polyline's direction."""
        (lon0, lat0), (lon1, lat1) = coords[0], coords[-1]
        midlon, midlat = (lon0 + lon1) / 2, (lat0 + lat1) / 2
        east = (lon1 - lon0) * 111_320 * math.cos(math.radians(midlat))
        north = (lat1 - lat0) * 110_540
        norm = math.hypot(east, north)
        if norm < 1e-6:
            return 0.0
        r, c = self._pixel(midlon, midlat)
        grad = self.gx[r, c] * east / norm + self.gy[r, c] * north / norm
        return round(float(grad) * 100.0, 1)


def apply_estimated_slopes(edges, model: TerrainModel) -> int:
    """Fill incline for edges that have no OSM incline value. Returns count."""
    n = 0
    for e in edges:
        if e.attrs.get("incline_pct") is not None or e.attrs.get("is_stairs"):
            continue
        slope = model.slope_along(e.coords)
        e.attrs["incline_pct"] = slope
        e.attrs["incline_source"] = "DEM"
        e.provenance.append(("incline_pct", str(slope), "DERIVED_DEM", "copernicus-glo30"))
        n += 1
    return n
