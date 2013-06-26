/*global define*/
define([
        './barycentricCoordinates',
        './defaultValue',
        './DeveloperError',
        './Cartesian2',
        './Cartesian3',
        './Cartesian4',
        './Cartographic',
        './EncodedCartesian3',
        './Intersect',
        './IntersectionTests',
        './Math',
        './Matrix3',
        './Matrix4',
        './Plane',
        './GeographicProjection',
        './ComponentDatatype',
        './IndexDatatype',
        './PrimitiveType',
        './Tipsify',
        './BoundingSphere',
        './Geometry',
        './GeometryAttribute'
    ], function(
        barycentricCoordinates,
        defaultValue,
        DeveloperError,
        Cartesian2,
        Cartesian3,
        Cartesian4,
        Cartographic,
        EncodedCartesian3,
        Intersect,
        IntersectionTests,
        CesiumMath,
        Matrix3,
        Matrix4,
        Plane,
        GeographicProjection,
        ComponentDatatype,
        IndexDatatype,
        PrimitiveType,
        Tipsify,
        BoundingSphere,
        Geometry,
        GeometryAttribute) {
    "use strict";

    /**
     * Content pipeline functions for geometries.  These functions generally modify geometry in place.
     *
     * @exports GeometryPipeline
     *
     * @see Geometry
     * @see Context#createVertexArrayFromGeometry
     */
    var GeometryPipeline = {};

    function addTriangle(lines, index, i0, i1, i2) {
        lines[index++] = i0;
        lines[index++] = i1;

        lines[index++] = i1;
        lines[index++] = i2;

        lines[index++] = i2;
        lines[index] = i0;
    }

    function trianglesToLines(triangles) {
        var count = triangles.length;
        var size = (count / 3) * 6;
        var lines = IndexDatatype.createTypedArray(count, size);

        var index = 0;
        for ( var i = 0; i < count; i += 3, index += 6) {
            addTriangle(lines, index, triangles[i], triangles[i + 1], triangles[i + 2]);
        }

        return lines;
    }

    function triangleStripToLines(triangles) {
        var count = triangles.length;
        if (count >= 3) {
            var size = (count - 2) * 6;
            var lines = IndexDatatype.createTypedArray(count, size);

            addTriangle(lines, 0, triangles[0], triangles[1], triangles[2]);
            var index = 6;

            for ( var i = 3; i < count; ++i, index += 6) {
                addTriangle(lines, index, triangles[i - 1], triangles[i], triangles[i - 2]);
            }

            return lines;
        }

        return new Uint16Array();
    }

    function triangleFanToLines(triangles) {
        if (triangles.length > 0) {
            var count = triangles.length - 1;
            var size = (count - 1) * 6;
            var lines = IndexDatatype.createTypedArray(count, size);

            var base = triangles[0];
            var index = 0;
            for ( var i = 1; i < count; ++i, index += 6) {
                addTriangle(lines, index, base, triangles[i], triangles[i + 1]);
            }

            return lines;
        }

        return new Uint16Array();
    }

    /**
     * Converts a geometry's triangle indices to line indices.  If the geometry has an <code>indices</code>
     * and its <code>primitiveType</code> is <code>TRIANGLES</code>, <code>TRIANGLE_STRIP</code>,
     * <code>TRIANGLE_FAN</code>, it is converted to <code>LINES</code>; otherwise, the geometry is not changed.
     * <p>
     * This is commonly used to create a wireframe geometry for visual debugging.
     * </p>
     *
     * @param {Geometry} geometry The geometry to modify, which is modified in place.
     *
     * @returns {Geometry} The modified <code>geometry</code> argument, with its triangle indices converted to lines.
     *
     * @exception {DeveloperError} geometry is required.
     *
     * @example
     * geometry = GeometryPipeline.toWireframe(geometry);
     */
    GeometryPipeline.toWireframe = function(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var indices = geometry.indices;
        if (typeof indices !== 'undefined') {
            switch (geometry.primitiveType) {
                case PrimitiveType.TRIANGLES:
                    geometry.indices = trianglesToLines(indices);
                    break;
                case PrimitiveType.TRIANGLE_STRIP:
                    geometry.indices = triangleStripToLines(indices);
                    break;
                case PrimitiveType.TRIANGLE_FAN:
                    geometry.indices = triangleFanToLines(indices);
                    break;
            }

            geometry.primitiveType = PrimitiveType.LINES;
        }

        return geometry;
    };

    /**
     * Creates an object that maps attribute names to unique indices for matching
     * vertex attributes and shader programs.
     *
     * @param {Geometry} geometry The geometry, which is not modified, to create the object for.
     *
     * @returns {Object} An object with attribute name / index pairs.
     *
     * @exception {DeveloperError} geometry is required.
     *
     * @example
     * var attributeIndices = GeometryPipeline.createAttributeIndices(geometry);
     * // Example output
     * // {
     * //   'position' : 0,
     * //   'normal' : 1
     * // }
     *
     * @see Context#createVertexArrayFromGeometry
     * @see ShaderCache
     */
    GeometryPipeline.createAttributeIndices = function(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        // There can be a WebGL performance hit when attribute 0 is disabled, so
        // assign attribute locations to well-known attributes.
        var semantics = [
            'position',
            'positionHigh',
            'positionLow',

            // From VertexFormat.position - after 2D projection and high-precision encoding
            'position3DHigh',
            'position3DLow',
            'position2DHigh',
            'position2DLow',

            // From Primitive
            'pickColor',

            // From VertexFormat
            'normal',
            'st',
            'binormal',
            'tangent'
        ];

        var attributes = geometry.attributes;
        var indices = {};
        var j = 0;
        var i;
        var len = semantics.length;

        // Attribute locations for well-known attributes
        for (i = 0; i < len; ++i) {
            var semantic = semantics[i];

            if (typeof attributes[semantic] !== 'undefined') {
                indices[semantic] = j++;
            }
        }

        // Locations for custom attributes
        for (var name in attributes) {
            if (attributes.hasOwnProperty(name) && (typeof indices[name] === 'undefined')) {
                indices[name] = j++;
            }
        }

        return indices;
    };

    /**
     * Reorders a geometry's attributes and <code>indices</code> to achieve better performance from the GPU's pre-vertex-shader cache.
     *
     * @param {Geometry} geometry The geometry to modify, which is modified in place.
     *
     * @returns {Geometry} The modified <code>geometry</code> argument, with its attributes and indices reordered for the GPU's pre-vertex-shader cache.
     *
     * @exception {DeveloperError} geometry is required.
     * @exception {DeveloperError} Each attribute array in geometry.attributes must have the same number of attributes.
     *
     * @example
     * geometry = GeometryPipeline.reorderForPreVertexCache(geometry);
     *
     * @see GeometryPipeline.reorderForPostVertexCache
     */
    GeometryPipeline.reorderForPreVertexCache = function(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var numVertices = Geometry.computeNumberOfVertices(geometry);

        var indices = geometry.indices;
        if (typeof indices !== 'undefined') {
            var indexCrossReferenceOldToNew = new Int32Array(numVertices);
            for ( var i = 0; i < numVertices; i++) {
                indexCrossReferenceOldToNew[i] = -1;
            }

            // Construct cross reference and reorder indices
            var indicesIn = indices;
            var numIndices = indicesIn.length;
            var indicesOut = IndexDatatype.createTypedArray(numVertices, numIndices);

            var intoIndicesIn = 0;
            var intoIndicesOut = 0;
            var nextIndex = 0;
            var tempIndex;
            while (intoIndicesIn < numIndices) {
                tempIndex = indexCrossReferenceOldToNew[indicesIn[intoIndicesIn]];
                if (tempIndex !== -1) {
                    indicesOut[intoIndicesOut] = tempIndex;
                } else {
                    tempIndex = indicesIn[intoIndicesIn];
                    if (tempIndex >= numVertices) {
                        throw new DeveloperError('Each attribute array in geometry.attributes must have the same number of attributes.');
                    }
                    indexCrossReferenceOldToNew[tempIndex] = nextIndex;

                    indicesOut[intoIndicesOut] = nextIndex;
                    ++nextIndex;
                }
                ++intoIndicesIn;
                ++intoIndicesOut;
            }
            geometry.indices = indicesOut;

            // Reorder attributes
            var attributes = geometry.attributes;
            for ( var property in attributes) {
                if (attributes.hasOwnProperty(property) && attributes[property].values) {
                    var attribute = attributes[property];
                    var elementsIn = attribute.values;
                    var intoElementsIn = 0;
                    var numComponents = attribute.componentsPerAttribute;
                    var elementsOut = attribute.componentDatatype.createTypedArray(elementsIn.length);
                    while (intoElementsIn < numVertices) {
                        var temp = indexCrossReferenceOldToNew[intoElementsIn];
                        for (i = 0; i < numComponents; i++) {
                            elementsOut[numComponents * temp + i] = elementsIn[numComponents * intoElementsIn + i];
                        }
                        ++intoElementsIn;
                    }
                    attribute.values = elementsOut;
                }
            }
        }

        return geometry;
    };

    /**
     * Reorders a geometry's <code>indices</code> to achieve better performance from the GPU's
     * post vertex-shader cache by using the Tipsify algorithm.  If the geometry <code>primitiveType</code>
     * is not <code>TRIANGLES</code> or the geometry does not have an <code>indices</code>, this function has no effect.
     *
     * @param {Geometry} geometry The geometry to modify, which is modified in place.
     * @param {Number} [cacheCapacity=24] The number of vertices that can be held in the GPU's vertex cache.
     *
     * @returns {Geometry} The modified <code>geometry</code> argument, with its indices reordered for the post-vertex-shader cache.
     *
     * @exception {DeveloperError} geometry is required.
     * @exception {DeveloperError} cacheCapacity must be greater than two.
     *
     * @example
     * geometry = GeometryPipeline.reorderForPostVertexCache(geometry);
     *
     * @see GeometryPipeline.reorderForPreVertexCache
     * @see <a href='http://gfx.cs.princeton.edu/pubs/Sander_2007_%3ETR/tipsy.pdf'>
     * Fast Triangle Reordering for Vertex Locality and Reduced Overdraw</a>
     * by Sander, Nehab, and Barczak
     */
    GeometryPipeline.reorderForPostVertexCache = function(geometry, cacheCapacity) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var indices = geometry.indices;
        if ((geometry.primitiveType === PrimitiveType.TRIANGLES) && (typeof indices !== 'undefined')) {
            var numIndices = indices.length;
            var maximumIndex = 0;
            for ( var j = 0; j < numIndices; j++) {
                if (indices[j] > maximumIndex) {
                    maximumIndex = indices[j];
                }
            }
            geometry.indices = Tipsify.tipsify({
                indices : indices,
                maximumIndex : maximumIndex,
                cacheSize : cacheCapacity
            });
        }

        return geometry;
    };

    function copyAttributesDescriptions(attributes) {
        var newAttributes = {};

        for ( var attribute in attributes) {
            if (attributes.hasOwnProperty(attribute) && attributes[attribute].values) {
                var attr = attributes[attribute];
                newAttributes[attribute] = new GeometryAttribute({
                    componentDatatype : attr.componentDatatype,
                    componentsPerAttribute : attr.componentsPerAttribute,
                    normalize : attr.normalize,
                    values : []
                });
            }
        }

        return newAttributes;
    }

    function copyVertex(destinationAttributes, sourceAttributes, index) {
        for ( var attribute in sourceAttributes) {
            if (sourceAttributes.hasOwnProperty(attribute) && sourceAttributes[attribute].values) {
                var attr = sourceAttributes[attribute];

                for ( var k = 0; k < attr.componentsPerAttribute; ++k) {
                    destinationAttributes[attribute].values.push(attr.values[(index * attr.componentsPerAttribute) + k]);
                }
            }
        }
    }

    /**
     * Splits a geometry into multiple geometries - if necessary - to ensure that indices in the
     * <code>indices</code> fit into unsigned shorts.  This is used to meet the WebGL requirements
     * when {@link Context#getElementIndexUint} is <code>false</code>.
     * <p>
     * If the geometry does not have an <code>indices</code>, this function has no effect.
     * </p>
     *
     * @param {Geometry} geometry The geometry to modify, which is modified in place if it needs to be split into multiple geometries.
     *
     * @returns {Array} An array of geometries, each with indices that fit into unsigned shorts.
     *
     * @exception {DeveloperError} geometry is required.
     * @exception {DeveloperError} geometry.primitiveType must equal to PrimitiveType.TRIANGLES, PrimitiveType.LINES, or PrimitiveType.POINTS
     * @exception {DeveloperError} All geometry attribute lists must have the same number of attributes.
     *
     * @example
     * var geometries = GeometryPipeline.fitToUnsignedShortIndices(geometry);
     */
    GeometryPipeline.fitToUnsignedShortIndices = function(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        if ((typeof geometry.indices !== 'undefined') &&
            ((geometry.primitiveType !== PrimitiveType.TRIANGLES) &&
             (geometry.primitiveType !== PrimitiveType.LINES) &&
             (geometry.primitiveType !== PrimitiveType.POINTS))) {
            throw new DeveloperError('geometry.primitiveType must equal to PrimitiveType.TRIANGLES, PrimitiveType.LINES, or PrimitiveType.POINTS.');
        }

        var geometries = [];

        // If there's an index list and more than 64K attributes, it is possible that
        // some indices are outside the range of unsigned short [0, 64K - 1]
        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        var sixtyFourK = 64 * 1024;
        if (typeof geometry.indices !== 'undefined' && (numberOfVertices > sixtyFourK)) {
            var oldToNewIndex = [];
            var newIndices = [];
            var currentIndex = 0;
            var newAttributes = copyAttributesDescriptions(geometry.attributes);

            var originalIndices = geometry.indices;
            var numberOfIndices = originalIndices.length;

            var indicesPerPrimitive;

            if (geometry.primitiveType === PrimitiveType.TRIANGLES) {
                indicesPerPrimitive = 3;
            } else if (geometry.primitiveType === PrimitiveType.LINES) {
                indicesPerPrimitive = 2;
            } else if (geometry.primitiveType === PrimitiveType.POINTS) {
                indicesPerPrimitive = 1;
            }

            for ( var j = 0; j < numberOfIndices; j += indicesPerPrimitive) {
                for (var k = 0; k < indicesPerPrimitive; ++k) {
                    var x = originalIndices[j + k];
                    var i = oldToNewIndex[x];
                    if (typeof i === 'undefined') {
                        i = currentIndex++;
                        oldToNewIndex[x] = i;
                        copyVertex(newAttributes, geometry.attributes, x);
                    }
                    newIndices.push(i);
                }

                if (currentIndex + indicesPerPrimitive > sixtyFourK) {
                    geometries.push(new Geometry({
                        attributes : newAttributes,
                        indices : newIndices,
                        primitiveType : geometry.primitiveType,
                        boundingSphere : geometry.boundingSphere
                    }));

                    // Reset for next vertex-array
                    oldToNewIndex = [];
                    newIndices = [];
                    currentIndex = 0;
                    newAttributes = copyAttributesDescriptions(geometry.attributes);
                }
            }

            if (newIndices.length !== 0) {
                geometries.push(new Geometry({
                    attributes : newAttributes,
                    indices : newIndices,
                    primitiveType : geometry.primitiveType,
                    boundingSphere : geometry.boundingSphere
                }));
            }
        } else {
            // No need to split into multiple geometries
            geometries.push(geometry);
        }

        return geometries;
    };

    var scratchProjectTo2DCartesian3 = new Cartesian3();
    var scratchProjectTo2DCartographic = new Cartographic();

    /**
     * Projects a geometry's 3D <code>position</code> attribute to 2D, replacing the <code>position</code>
     * attribute with separate <code>position3D</code> and <code>position2D</code> attributes.
     * <p>
     * If the geometry does not have a <code>position</code>, this function has no effect.
     * </p>
     *
     * @param {Geometry} geometry The geometry to modify, which is modified in place.
     * @param {Object} [projection=new GeographicProjection()] The projection to use.
     *
     * @returns {Geometry} The modified <code>geometry</code> argument with <code>position3D</code> and <code>position2D</code> attributes.
     *
     * @exception {DeveloperError} geometry is required.
     *
     * @example
     * geometry = GeometryPipeline.projectTo2D(geometry);
     */
    GeometryPipeline.projectTo2D = function(geometry, projection) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        if (typeof geometry.attributes.position !== 'undefined') {
            projection = (typeof projection !== 'undefined') ? projection : new GeographicProjection();
            var ellipsoid = projection.getEllipsoid();

            // Project original positions to 2D.
            var wgs84Positions = geometry.attributes.position.values;
            var projectedPositions = new Float64Array(wgs84Positions.length);
            var index = 0;

            for ( var i = 0; i < wgs84Positions.length; i += 3) {
                var position = Cartesian3.fromArray(wgs84Positions, i, scratchProjectTo2DCartesian3);
                var lonLat = ellipsoid.cartesianToCartographic(position, scratchProjectTo2DCartographic);
                var projectedLonLat = projection.project(lonLat, scratchProjectTo2DCartesian3);

                projectedPositions[index++] = projectedLonLat.x;
                projectedPositions[index++] = projectedLonLat.y;
                projectedPositions[index++] = projectedLonLat.z;
            }

            // Rename original positions to WGS84 Positions.
            geometry.attributes.position3D = geometry.attributes.position;

            // Replace original positions with 2D projected positions
            geometry.attributes.position2D = new GeometryAttribute({
                componentDatatype : ComponentDatatype.DOUBLE,
                componentsPerAttribute : 3,
                values : projectedPositions
            });
            delete geometry.attributes.position;
        }

        return geometry;
    };

    var encodedResult = {
        high : 0.0,
        low : 0.0
    };

    /**
     * Encodes floating-point geometry attribute values as two separate attributes to improve
     * rendering precision using the same encoding as {@link EncodedCartesian3}.
     * <p>
     * This is commonly used to create high-precision position vertex attributes.
     * </p>
     *
     * @param {Geometry} geometry The geometry to modify, which is modified in place.
     * @param {String} [attributeName='position'] The name of the attribute.
     * @param {String} [attributeHighName='positionHigh'] The name of the attribute for the encoded high bits.
     * @param {String} [attributeLowName='positionLow'] The name of the attribute for the encoded low bits.
     *
     * @returns {Geometry} The modified <code>geometry</code> argument, with its encoded attribute.
     *
     * @exception {DeveloperError} geometry is required.
     * @exception {DeveloperError} geometry must have attribute matching the attributeName argument.
     * @exception {DeveloperError} The attribute componentDatatype must be ComponentDatatype.DOUBLE.
     *
     * @example
     * geometry = GeometryPipeline.encodeAttribute(geometry, 'position3D', 'position3DHigh', 'position3DLow');
     *
     * @see EncodedCartesian3
     */
    GeometryPipeline.encodeAttribute = function(geometry, attributeName, attributeHighName, attributeLowName) {
        attributeName = defaultValue(attributeName, 'position');
        attributeHighName = defaultValue(attributeHighName, 'positionHigh');
        attributeLowName = defaultValue(attributeLowName, 'positionLow');

        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var attribute = geometry.attributes[attributeName];

        if (typeof attribute === 'undefined') {
            throw new DeveloperError('geometry must have attribute matching the attributeName argument: ' + attributeName + '.');
        }

        if (attribute.componentDatatype !== ComponentDatatype.DOUBLE) {
            throw new DeveloperError('The attribute componentDatatype must be ComponentDatatype.DOUBLE.');
        }

        var values = attribute.values;
        var length = values.length;
        var highValues = new Float32Array(length);
        var lowValues = new Float32Array(length);

        for (var i = 0; i < length; ++i) {
            EncodedCartesian3.encode(values[i], encodedResult);
            highValues[i] = encodedResult.high;
            lowValues[i] = encodedResult.low;
        }

        var componentsPerAttribute = attribute.componentsPerAttribute;

        geometry.attributes[attributeHighName] = new GeometryAttribute({
            componentDatatype : ComponentDatatype.FLOAT,
            componentsPerAttribute : componentsPerAttribute,
            values : highValues
        });
        geometry.attributes[attributeLowName] = new GeometryAttribute({
            componentDatatype : ComponentDatatype.FLOAT,
            componentsPerAttribute : componentsPerAttribute,
            values : lowValues
        });
        delete geometry.attributes[attributeName];

        return geometry;
    };

    var scratch = new Cartesian3();

    function transformPoint(matrix, attribute) {
        if (typeof attribute !== 'undefined') {
            var values = attribute.values;
            var length = values.length;
            for (var i = 0; i < length; i += 3) {
                Cartesian3.fromArray(values, i, scratch);
                Matrix4.multiplyByPoint(matrix, scratch, scratch);
                values[i] = scratch.x;
                values[i + 1] = scratch.y;
                values[i + 2] = scratch.z;
            }
        }
    }

    function transformVector(matrix, attribute) {
        if (typeof attribute !== 'undefined') {
            var values = attribute.values;
            var length = values.length;
            for (var i = 0; i < length; i += 3) {
                Cartesian3.fromArray(values, i, scratch);
                Matrix3.multiplyByVector(matrix, scratch, scratch);
                values[i] = scratch.x;
                values[i + 1] = scratch.y;
                values[i + 2] = scratch.z;
            }
        }
    }

    var inverseTranspose = new Matrix4();
    var normalMatrix = new Matrix3();

    /**
     * Transforms a geometry instance to world coordinates.  This is used as a prerequisite
     * to batch together several instances with {@link GeometryPipeline.combine}.  This changes
     * the instance's <code>modelMatrix</code> to {@see Matrix4.IDENTITY} and transforms the
     * following attributes if they are present: <code>position</code>, <code>normal</code>,
     * <code>binormal</code>, and <code>tangent</code>.
     *
     * @param {GeometryInstance} instance The geometry instance to modify, which is modified in place.
     *
     * @returns {GeometryInstance} The modified <code>instance</code> argument, with its attributes transforms to world coordinates.
     *
     * @exception {DeveloperError} instance is required.
     *
     * @example
     * for (var i = 0; i < instances.length; ++i) {
     *   GeometryPipeline.transformToWorldCoordinates(instances[i]);
     * }
     * var geometry = GeometryPipeline.combine(instances);
     *
     * @see GeometryPipeline.combine
     */
    GeometryPipeline.transformToWorldCoordinates = function(instance) {
        if (typeof instance === 'undefined') {
            throw new DeveloperError('instance is required.');
        }

        var modelMatrix = instance.modelMatrix;

        if (modelMatrix.equals(Matrix4.IDENTITY)) {
            // Already in world coordinates
            return;
        }

        var attributes = instance.geometry.attributes;

        // Transform attributes in known vertex formats
        transformPoint(modelMatrix, attributes.position);

        if ((typeof attributes.normal !== 'undefined') ||
            (typeof attributes.binormal !== 'undefined') ||
            (typeof attributes.tangent !== 'undefined')) {

            Matrix4.inverse(modelMatrix, inverseTranspose);
            Matrix4.transpose(inverseTranspose, inverseTranspose);
            Matrix4.getRotation(inverseTranspose, normalMatrix);

            transformVector(normalMatrix, attributes.normal);
            transformVector(normalMatrix, attributes.binormal);
            transformVector(normalMatrix, attributes.tangent);
        }

        var boundingSphere = instance.geometry.boundingSphere;

        if (typeof boundingSphere !== 'undefined') {
            Matrix4.multiplyByPoint(modelMatrix, boundingSphere.center, boundingSphere.center);
            boundingSphere.center = Cartesian3.fromCartesian4(boundingSphere.center);
        }

        instance.modelMatrix = Matrix4.IDENTITY.clone();

        return instance;
    };

    function findAttributesInAllGeometries(instances) {
        var length = instances.length;

        var attributesInAllGeometries = {};

        var attributes0 = instances[0].geometry.attributes;
        var name;

        for (name in attributes0) {
            if (attributes0.hasOwnProperty(name)) {
                var attribute = attributes0[name];
                var numberOfComponents = attribute.values.length;
                var inAllGeometries = true;

                // Does this same attribute exist in all geometries?
                for (var i = 1; i < length; ++i) {
                    var otherAttribute = instances[i].geometry.attributes[name];

                    if ((typeof otherAttribute === 'undefined') ||
                        (attribute.componentDatatype !== otherAttribute.componentDatatype) ||
                        (attribute.componentsPerAttribute !== otherAttribute.componentsPerAttribute) ||
                        (attribute.normalize !== otherAttribute.normalize)) {

                        inAllGeometries = false;
                        break;
                    }

                    numberOfComponents += otherAttribute.values.length;
                }

                if (inAllGeometries) {
                    attributesInAllGeometries[name] = new GeometryAttribute({
                        componentDatatype : attribute.componentDatatype,
                        componentsPerAttribute : attribute.componentsPerAttribute,
                        normalize : attribute.normalize,
                        values : attribute.componentDatatype.createTypedArray(numberOfComponents)
                    });
                }
            }
        }

        return attributesInAllGeometries;
    }

    /**
     * Combines geometry from several {@link GeometryInstance} objects into one geometry.
     * This concatenates the attributes, concatenates and adjusts the indices, and creates
     * a bounding sphere encompassing all instances.
     * <p>
     * If the instances do not have the same attributes, a subset of attributes common
     * to all instances is used, and the others are ignored.
     * </p>
     * <p>
     * This is used by {@link Primitive} to efficiently render a large amount of static data.
     * </p>
     *
     * @param {Array} [instances] The array of {@link GeometryInstance} objects whose geometry will be combined.
     *
     * @returns {Geometry} A new geometry created from the provided geometry instances.
     *
     * @exception {DeveloperError} instances is required and must have length greater than zero.
     * @exception {DeveloperError} All instances must have the same modelMatrix.
     * @exception {DeveloperError} All instance geometries must have an indices or not have one.
     * @exception {DeveloperError} All instance geometries must have the same primitiveType.
     *
     * @example
     * for (var i = 0; i < instances.length; ++i) {
     *   GeometryPipeline.transformToWorldCoordinates(instances[i]);
     * }
     * var geometry = GeometryPipeline.combine(instances);
     *
     * @see GeometryPipeline.transformToWorldCoordinates
     */
    GeometryPipeline.combine = function(instances) {
        if ((typeof instances === 'undefined') || (instances.length < 1)) {
            throw new DeveloperError('instances is required and must have length greater than zero.');
        }

        var length = instances.length;

        if (length === 1) {
            return instances[0].geometry;
        }

        var name;
        var i;
        var j;
        var k;

        var m = instances[0].modelMatrix;
        var haveIndices = (typeof instances[0].geometry.indices !== 'undefined');
        var primitiveType = instances[0].geometry.primitiveType;

        for (i = 1; i < length; ++i) {
            if (!Matrix4.equals(instances[i].modelMatrix, m)) {
                throw new DeveloperError('All instances must have the same modelMatrix.');
            }

            if ((typeof instances[i].geometry.indices !== 'undefined') !== haveIndices) {
                throw new DeveloperError('All instance geometries must have an indices or not have one.');
            }

            if (instances[i].geometry.primitiveType !== primitiveType) {
                throw new DeveloperError('All instance geometries must have the same primitiveType.');
            }
        }

        // Find subset of attributes in all geometries
        var attributes = findAttributesInAllGeometries(instances);
        var values;
        var sourceValues;
        var sourceValuesLength;

        // Combine attributes from each geometry into a single typed array
        for (name in attributes) {
            if (attributes.hasOwnProperty(name)) {
                values = attributes[name].values;

                k = 0;
                for (i = 0; i < length; ++i) {
                    sourceValues = instances[i].geometry.attributes[name].values;
                    sourceValuesLength = sourceValues.length;

                    for (j = 0; j < sourceValuesLength; ++j) {
                        values[k++] = sourceValues[j];
                    }
                }
            }
        }

        // Combine index lists
        var indices;

        if (haveIndices) {
            var numberOfIndices = 0;
            for (i = 0; i < length; ++i) {
                numberOfIndices += instances[i].geometry.indices.length;
            }

            var numberOfVertices = Geometry.computeNumberOfVertices(new Geometry({
                attributes : attributes
            }));
            var destIndices = IndexDatatype.createTypedArray(numberOfVertices, numberOfIndices);

            var destOffset = 0;
            var offset = 0;

            for (i = 0; i < length; ++i) {
                var sourceIndices = instances[i].geometry.indices;
                var sourceIndicesLen = sourceIndices.length;

                for (k = 0; k < sourceIndicesLen; ++k) {
                    destIndices[destOffset++] = offset + sourceIndices[k];
                }

                offset += Geometry.computeNumberOfVertices(instances[i].geometry);
            }

            indices = destIndices;
        }

        // Create bounding sphere that includes all instances
        var boundingSphere;

        for (i = 0; i < length; ++i) {
            var bs = instances[i].geometry.boundingSphere;
            if (typeof bs === 'undefined') {
                // If any geometries have an undefined bounding sphere, then so does the combined geometry
                boundingSphere = undefined;
                break;
            }

            if (typeof boundingSphere === 'undefined') {
                boundingSphere = bs.clone();
            } else {
                BoundingSphere.union(boundingSphere, bs, boundingSphere);
            }
        }

        return new Geometry({
            attributes : attributes,
            indices : indices,
            primitiveType : primitiveType,
            boundingSphere : boundingSphere
        });
    };

    var normal = new Cartesian3();
    var v0 = new Cartesian3();
    var v1 = new Cartesian3();
    var v2 = new Cartesian3();

    /**
     * Computes per-vertex normals for a geometry containing <code>TRIANGLES</code> by averaging the normals of
     * all triangles incident to the vertex.  The result is a new <code>normal</code> attribute added to the geometry.
     * This assumes a counter-clockwise winding order.
     * <p>
     * This function has no effect if the geometry's <code>indices</code> is undefined or the <code>
     * primitiveType</code> is not {@link PrimitiveType.TRIANGLES} or the geometry does not have a
     * <code>position</code> attribute.
     * </p>
     *
     * @param {Geometry} geometry The geometry to modify, which is modified in place.
     *
     * @returns {Geometry} The modified <code>geometry</code> argument with the computed <code>normal</code> attribute.
     *
     * @exception {DeveloperError} geometry is required
     *
     * @example
     * GeometryPipeline.computeNormal(geometry);
     */
    GeometryPipeline.computeNormal = function(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var attributes = geometry.attributes;
        var indices = geometry.indices;

        if (typeof attributes.position === 'undefined' ||
            typeof attributes.position.values === 'undefined' ||
            geometry.primitiveType !== PrimitiveType.TRIANGLES ||
            typeof indices === 'undefined' ||
            indices.length < 2 ||
            indices.length % 3 !== 0) {

            return geometry;
        }

        var vertices = geometry.attributes.position.values;
        var numVertices = geometry.attributes.position.values.length / 3;
        var numIndices = indices.length;
        var normalsPerVertex = new Array(numVertices);
        var normalsPerTriangle = new Array(numIndices / 3);
        var normalIndices = new Array(numIndices);

        for (var i = 0; i < numVertices; i++) {
            normalsPerVertex[i] = {
                indexOffset : 0,
                count : 0,
                currentCount : 0
            };
        }

        var j = 0;
        for (i = 0; i < numIndices; i += 3) {
            var i0 = indices[i];
            var i1 = indices[i + 1];
            var i2 = indices[i + 2];
            var i03 = i0*3;
            var i13 = i1*3;
            var i23 = i2*3;

            v0.x = vertices[i03];
            v0.y = vertices[i03 + 1];
            v0.z = vertices[i03 + 2];
            v1.x = vertices[i13];
            v1.y = vertices[i13 + 1];
            v1.z = vertices[i13 + 2];
            v2.x = vertices[i23];
            v2.y = vertices[i23 + 1];
            v2.z = vertices[i23 + 2];

            normalsPerVertex[i0].count++;
            normalsPerVertex[i1].count++;
            normalsPerVertex[i2].count++;

            v1.subtract(v0, v1);
            v2.subtract(v0, v2);
            normalsPerTriangle[j] = v1.cross(v2);
            j++;
        }

        var indexOffset = 0;
        for (i = 0; i < numVertices; i++) {
            normalsPerVertex[i].indexOffset += indexOffset;
            indexOffset += normalsPerVertex[i].count;
        }

        j = 0;
        var vertexNormalData;
        for (i = 0; i < numIndices; i += 3) {
            vertexNormalData = normalsPerVertex[indices[i]];
            var index = vertexNormalData.indexOffset + vertexNormalData.currentCount;
            normalIndices[index] = j;
            vertexNormalData.currentCount++;

            vertexNormalData = normalsPerVertex[indices[i + 1]];
            index = vertexNormalData.indexOffset + vertexNormalData.currentCount;
            normalIndices[index] = j;
            vertexNormalData.currentCount++;

            vertexNormalData = normalsPerVertex[indices[i + 2]];
            index = vertexNormalData.indexOffset + vertexNormalData.currentCount;
            normalIndices[index] = j;
            vertexNormalData.currentCount++;

            j++;
        }

        var normalValues = new Float32Array(numVertices * 3);
        for (i = 0; i < numVertices; i++) {
            var i3 = i * 3;
            vertexNormalData = normalsPerVertex[i];
            if (vertexNormalData.count > 0) {
                Cartesian3.ZERO.clone(normal);
                for (j = 0; j < vertexNormalData.count; j++) {
                    normal.add(normalsPerTriangle[normalIndices[vertexNormalData.indexOffset + j]], normal);
                }
                normal.normalize(normal);
                normalValues[i3] = normal.x;
                normalValues[i3 + 1] = normal.y;
                normalValues[i3 + 2] = normal.z;
            } else {
                normalValues[i3] = 0.0;
                normalValues[i3 + 1] = 0.0;
                normalValues[i3 + 2] = 1.0;
            }
        }

        geometry.attributes.normal = new GeometryAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 3,
            values: normalValues
        });

        return geometry;
    };

    var normalScratch = new Cartesian3();
    var normalScale = new Cartesian3();
    var tScratch = new Cartesian3();

    /**
     * Computes per-vertex binormals and tangents for a geometry containing <code>TRIANGLES</code>.
     * The result is new <code>binormal</code> and <code>tangent</code> attributes added to the geometry.
     * This assumes a counter-clockwise winding order.
     * <p>
     * This function has no effect if the geometry's <code>indices</code> is undefined or the <code>
     * primitiveType</code> is not {@link PrimitiveType.TRIANGLES} or the geometry does not have
     * <code>position</code>, <code>normal</code>, and <code>st</code> attributes.
     * </p>
     * <p>
     * Based on <a href="http://www.terathon.com/code/tangent.html">Computing Tangent Space Basis Vectors
     * for an Arbitrary Mesh</a> by Eric Lengyel.
     * </p>
     *
     * @param {Geometry} geometry The geometry to modify, which is modified in place.
     *
     * @returns {Geometry} The modified <code>geometry</code> argument with the computed <code>binormal</code> and <code>tangent</code> attributes.
     *
     * @exception {DeveloperError} geometry is required.
     *
     * @example
     * GeometryPipeline.computeBinormalAndTangent(geometry);
     */
    GeometryPipeline.computeBinormalAndTangent = function(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var attributes = geometry.attributes;
        var vertices = geometry.attributes.position.values;
        var normals = geometry.attributes.normal.values;
        var st = geometry.attributes.st.values;
        var indices = geometry.indices;

        if ((typeof attributes.position === 'undefined' || typeof attributes.position.values === 'undefined') ||
            (typeof attributes.normal === 'undefined' || typeof attributes.normal.values === 'undefined') ||
            (typeof attributes.st === 'undefined' || typeof attributes.st.values === 'undefined') ||
            geometry.primitiveType !== PrimitiveType.TRIANGLES ||
            typeof indices === 'undefined' ||
            indices.length < 2 ||
            indices.length % 3 !== 0) {

            return geometry;
        }

        var numVertices = geometry.attributes.position.values.length/3;
        var numIndices = indices.length;
        var tan1 = new Array(numVertices * 3);

        for (var i = 0; i < tan1.length; i++) {
            tan1[i] = 0;
        }

        var i03;
        var i13;
        var i23;
        for (i = 0; i < numIndices; i+=3) {
            var i0 = indices[i];
            var i1 = indices[i + 1];
            var i2 = indices[i + 2];
            i03 = i0*3;
            i13 = i1*3;
            i23 = i2*3;
            var i02 = i0*2;
            var i12 = i1*2;
            var i22 = i2*2;

            var ux = vertices[i03];
            var uy = vertices[i03 + 1];
            var uz = vertices[i03 + 2];

            var wx = st[i02];
            var wy = st[i02 + 1];
            var t1 = st[i12 + 1] - wy;
            var t2 = st[i22 + 1] - wy;

            var r = 1.0 / ((st[i12] - wx) * t2 - (st[i22] - wx) * t1);
            var sdirx = (t2 * (vertices[i13] - ux) - t1 * (vertices[i23] - ux)) * r;
            var sdiry = (t2 * (vertices[i13 + 1] - uy) - t1 * (vertices[i23 + 1] - uy)) * r;
            var sdirz = (t2 * (vertices[i13 + 2] - uz) - t1 * (vertices[i23 + 2] - uz)) * r;

            tan1[i03] += sdirx;
            tan1[i03+1] += sdiry;
            tan1[i03+2] += sdirz;

            tan1[i13] += sdirx;
            tan1[i13+1] += sdiry;
            tan1[i13+2] += sdirz;

            tan1[i23] += sdirx;
            tan1[i23+1] += sdiry;
            tan1[i23+2] += sdirz;
        }

        var binormalValues = new Float32Array(numVertices * 3);
        var tangentValues = new Float32Array(numVertices * 3);

        for (i = 0; i < numVertices; i++) {
            i03 = i * 3;
            i13 = i03 + 1;
            i23 = i03 + 2;

            var n = Cartesian3.fromArray(normals, i03, normalScratch);
            var t = Cartesian3.fromArray(tan1, i03, tScratch);
            var scalar = n.dot(t);
            n.multiplyByScalar(scalar, normalScale);
            t.subtract(normalScale, t).normalize(t);

            tangentValues[i03] = t.x;
            tangentValues[i13] = t.y;
            tangentValues[i23] = t.z;

            n.cross(t, t).normalize(t);

            binormalValues[i03] = t.x;
            binormalValues[i13] = t.y;
            binormalValues[i23] = t.z;
        }

        geometry.attributes.tangent = new GeometryAttribute({
            componentDatatype : ComponentDatatype.FLOAT,
            componentsPerAttribute : 3,
            values : tangentValues
        });

        geometry.attributes.binormal = new GeometryAttribute({
            componentDatatype : ComponentDatatype.FLOAT,
            componentsPerAttribute : 3,
            values : binormalValues
        });

        return geometry;
    };

    function indexTriangles(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        if (typeof geometry.indices !== 'undefined') {
            return geometry;
        }

        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        if (numberOfVertices < 3) {
            throw new DeveloperError('The number of vertices must be at least three.');
        }

        if (numberOfVertices % 3 !== 0) {
            throw new DeveloperError('The number of vertices must be a multiple of three.');
        }

        var indices = IndexDatatype.createTypedArray(numberOfVertices, numberOfVertices);
        for (var i = 0; i < numberOfVertices; ++i) {
            indices[i] = i;
        }

        geometry.indices = indices;
        return geometry;
    }

    function indexTriangleFan(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        if (numberOfVertices < 3) {
            throw new DeveloperError('The number of vertices must be at least three.');
        }

        var indices = IndexDatatype.createTypedArray(numberOfVertices, (numberOfVertices - 2) * 3);
        indices[0] = 1;
        indices[1] = 0;
        indices[2] = 2;

        var indicesIndex = 3;
        for (var i = 3; i < numberOfVertices; ++i) {
            indices[indicesIndex++] = i - 1;
            indices[indicesIndex++] = 0;
            indices[indicesIndex++] = i;
        }

        geometry.indices = indices;
        geometry.primitiveType = PrimitiveType.TRIANGLES;
        return geometry;
    }

    function indexTriangleStrip(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        if (numberOfVertices < 3) {
            throw new DeveloperError('The number of vertices must be at least 3.');
        }

        var indices = IndexDatatype.createTypedArray(numberOfVertices, (numberOfVertices - 2) * 3);
        indices[0] = 0;
        indices[1] = 1;
        indices[2] = 2;

        if (numberOfVertices > 3) {
            indices[3] = 0;
            indices[4] = 2;
            indices[5] = 3;
        }

        var indicesIndex = 6;
        for (var i = 3; i < numberOfVertices - 1; i += 2) {
            indices[indicesIndex++] = i;
            indices[indicesIndex++] = i - 1;
            indices[indicesIndex++] = i + 1;

            if (i + 2 < numberOfVertices) {
                indices[indicesIndex++] = i;
                indices[indicesIndex++] = i + 1;
                indices[indicesIndex++] = i + 2;
            }
        }

        geometry.indices = indices;
        geometry.primitiveType = PrimitiveType.TRIANGLES;
        return geometry;
    }

    function indexLines(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('undefined');
        }

        if (typeof geometry.indices !== 'undefined') {
            return geometry;
        }

        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        if (numberOfVertices < 2) {
            throw new DeveloperError('The number of vertices must be at least two.');
        }

        if (numberOfVertices % 2 !== 0) {
            throw new DeveloperError('The number of vertices must be a multiple of 2.');
        }

        var indices = IndexDatatype.createTypedArray(numberOfVertices, numberOfVertices);
        for (var i = 0; i < numberOfVertices; ++i) {
            indices[i] = i;
        }

        geometry.indices = indices;
        return geometry;
    }

    function indexLineStrip(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        if (numberOfVertices < 2) {
            throw new DeveloperError('The number of vertices must be at least two.');
        }
        var indices = IndexDatatype.createTypedArray(numberOfVertices, (numberOfVertices - 1) * 2);

        indices[0] = 0;
        indices[1] = 1;

        var indicesIndex = 2;
        for (var i = 2; i < numberOfVertices; ++i) {
            indices[indicesIndex++] = i - 1;
            indices[indicesIndex++] = i;
        }

        geometry.indices = indices;
        geometry.primitiveType = PrimitiveType.LINES;
        return geometry;
    }

    function indexLineLoop(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        if (numberOfVertices < 2) {
            throw new DeveloperError('The number of vertices must be at least two.');
        }

        var indices = IndexDatatype.createTypedArray(numberOfVertices, numberOfVertices * 2);

        indices[0] = 0;
        indices[1] = 1;

        var indicesIndex = 2;
        for (var i = 2; i < numberOfVertices; ++i) {
            indices[indicesIndex++] = i - 1;
            indices[indicesIndex++] = i;
        }

        indices[indicesIndex++] = numberOfVertices - 1;
        indices[indicesIndex] = 0;

        geometry.indices = indices;
        geometry.primitiveType = PrimitiveType.LINES;
        return geometry;
    }

    function indexPrimitive(geometry) {
        switch (geometry.primitiveType) {
        case PrimitiveType.TRIANGLE_FAN:
            return indexTriangleFan(geometry);
        case PrimitiveType.TRIANGLE_STRIP:
            return indexTriangleStrip(geometry);
        case PrimitiveType.TRIANGLES:
            return indexTriangles(geometry);
        case PrimitiveType.LINE_STRIP:
            return indexLineStrip(geometry);
        case PrimitiveType.LINE_LOOP:
            return indexLineLoop(geometry);
        case PrimitiveType.LINES:
            return indexLines(geometry);
        }

        return geometry;
    }

    function offsetPointFromXZPlane(p, isBehind) {
        if (Math.abs(p.y) < CesiumMath.EPSILON11){
            if (isBehind) {
                p.y = -CesiumMath.EPSILON11;
            } else {
                p.y = CesiumMath.EPSILON11;
            }
        }
    }

    var c3 = new Cartesian3();
    function getXZIntersectionOffsetPoints(p, p1, u1, v1) {
        p.add(p1.subtract(p, c3).multiplyByScalar(p.y/(p.y-p1.y), c3), u1);
        Cartesian3.clone(u1, v1);
        offsetPointFromXZPlane(u1, true);
        offsetPointFromXZPlane(v1, false);
    }

    var u1 = new Cartesian3();
    var u2 = new Cartesian3();
    var q1 = new Cartesian3();
    var q2 = new Cartesian3();

    var splitTriangleResult = {
        positions : new Array(7),
        indices : new Array(3 * 3)
    };

    function splitTriangle(p0, p1, p2) {
        // In WGS84 coordinates, for a triangle approximately on the
        // ellipsoid to cross the IDL, first it needs to be on the
        // negative side of the plane x = 0.
        if ((p0.x < 0.0) && (p1.x < 0.0) && (p2.x < 0.0)) {
            var p0Behind = p0.y < 0.0;
            var p1Behind = p1.y < 0.0;
            var p2Behind = p2.y < 0.0;

            offsetPointFromXZPlane(p0, p0Behind);
            offsetPointFromXZPlane(p1, p1Behind);
            offsetPointFromXZPlane(p2, p2Behind);

            var numBehind = 0;
            numBehind += p0Behind ? 1 : 0;
            numBehind += p1Behind ? 1 : 0;
            numBehind += p2Behind ? 1 : 0;

            var indices = splitTriangleResult.indices;

            if (numBehind === 1) {
                indices[1] = 3;
                indices[2] = 4;
                indices[5] = 6;
                indices[7] = 6;
                indices[8] = 5;

                if (p0Behind) {
                    getXZIntersectionOffsetPoints(p0, p1, u1, q1);
                    getXZIntersectionOffsetPoints(p0, p2, u2, q2);

                    indices[0] = 0;
                    indices[3] = 1;
                    indices[4] = 2;
                    indices[6] = 1;
                } else if (p1Behind) {
                    getXZIntersectionOffsetPoints(p1, p0, u1, q1);
                    getXZIntersectionOffsetPoints(p1, p2, u2, q2);

                    indices[0] = 1;
                    indices[3] = 2;
                    indices[4] = 0;
                    indices[6] = 2;
                } else if (p2Behind) {
                    getXZIntersectionOffsetPoints(p2, p0, u1, q1);
                    getXZIntersectionOffsetPoints(p2, p1, u2, q2);

                    indices[0] = 2;
                    indices[3] = 0;
                    indices[4] = 1;
                    indices[6] = 0;
                }
            } else if (numBehind === 2) {
                indices[2] = 4;
                indices[4] = 4;
                indices[5] = 3;
                indices[7] = 5;
                indices[8] = 6;

                if (!p0Behind) {
                    getXZIntersectionOffsetPoints(p0, p1, u1, q1);
                    getXZIntersectionOffsetPoints(p0, p2, u2, q2);

                    indices[0] = 1;
                    indices[1] = 2;
                    indices[3] = 1;
                    indices[6] = 0;
                } else if (!p1Behind) {
                    getXZIntersectionOffsetPoints(p1, p2, u1, q1);
                    getXZIntersectionOffsetPoints(p1, p0, u2, q2);

                    indices[0] = 2;
                    indices[1] = 0;
                    indices[3] = 2;
                    indices[6] = 1;
                } else if (!p2Behind) {
                    getXZIntersectionOffsetPoints(p2, p0, u1, q1);
                    getXZIntersectionOffsetPoints(p2, p1, u2, q2);

                    indices[0] = 0;
                    indices[1] = 1;
                    indices[3] = 0;
                    indices[6] = 2;
                }
            }

            var positions = splitTriangleResult.positions;
            positions[0] = p0;
            positions[1] = p1;
            positions[2] = p2;
            splitTriangleResult.length = 3;

            if (numBehind === 1 || numBehind === 2) {
                positions[3] = u1;
                positions[4] = u2;
                positions[5] = q1;
                positions[6] = q2;
                splitTriangleResult.length = 7;
            }

            return splitTriangleResult;
        }

        return undefined;
    }

    function computeTriangleAttributes(i0, i1, i2, dividedTriangle, normals, binormals, tangents, texCoords) {
        if (typeof normals === 'undefined' && typeof binormals === 'undefined' &&
                typeof tangents === 'undefined' && typeof texCoords === 'undefined') {
            return;
        }

        var positions = dividedTriangle.positions;
        var p0 = positions[0];
        var p1 = positions[1];
        var p2 = positions[2];

        var n0, n1, n2;
        var b0, b1, b2;
        var t0, t1, t2;
        var s0, s1, s2;
        var v0, v1, v2;
        var u0, u1, u2;

        if (typeof normals !== 'undefined') {
            n0 = Cartesian3.fromArray(normals, i0 * 3);
            n1 = Cartesian3.fromArray(normals, i1 * 3);
            n2 = Cartesian3.fromArray(normals, i2 * 3);
        }

        if (typeof binormals !== 'undefined') {
            b0 = Cartesian3.fromArray(binormals, i0 * 3);
            b1 = Cartesian3.fromArray(binormals, i1 * 3);
            b2 = Cartesian3.fromArray(binormals, i2 * 3);
        }

        if (typeof tangents !== 'undefined') {
            t0 = Cartesian3.fromArray(tangents, i0 * 3);
            t1 = Cartesian3.fromArray(tangents, i1 * 3);
            t2 = Cartesian3.fromArray(tangents, i2 * 3);
        }

        if (typeof texCoords !== 'undefined') {
            s0 = Cartesian2.fromArray(texCoords, i0 * 2);
            s1 = Cartesian2.fromArray(texCoords, i1 * 2);
            s2 = Cartesian2.fromArray(texCoords, i2 * 2);
        }

        for (var i = 3; i < positions.length; ++i) {
            var point = positions[i];
            var coords = barycentricCoordinates(point, p0, p1, p2);

            if (typeof normals !== 'undefined') {
                v0 = Cartesian3.multiplyByScalar(n0, coords.x, v0);
                v1 = Cartesian3.multiplyByScalar(n1, coords.y, v1);
                v2 = Cartesian3.multiplyByScalar(n2, coords.z, v2);

                var normal = Cartesian3.add(v0, v1);
                Cartesian3.add(normal, v2, normal);
                Cartesian3.normalize(normal, normal);

                normals.push(normal.x, normal.y, normal.z);
            }

            if (typeof binormals !== 'undefined') {
                v0 = Cartesian3.multiplyByScalar(b0, coords.x, v0);
                v1 = Cartesian3.multiplyByScalar(b1, coords.y, v1);
                v2 = Cartesian3.multiplyByScalar(b2, coords.z, v2);

                var binormal = Cartesian3.add(v0, v1);
                Cartesian3.add(binormal, v2, binormal);
                Cartesian3.normalize(binormal, binormal);

                binormals.push(binormal.x, binormal.y, binormal.z);
            }

            if (typeof tangents !== 'undefined') {
                v0 = Cartesian3.multiplyByScalar(t0, coords.x, v0);
                v1 = Cartesian3.multiplyByScalar(t1, coords.y, v1);
                v2 = Cartesian3.multiplyByScalar(t2, coords.z, v2);

                var tangent = Cartesian3.add(v0, v1);
                Cartesian3.add(tangent, v2, tangent);
                Cartesian3.normalize(tangent, tangent);

                tangents.push(tangent.x, tangent.y, tangent.z);
            }

            if (typeof texCoords !== 'undefined') {
                u0 = Cartesian2.multiplyByScalar(s0, coords.x, u0);
                u1 = Cartesian2.multiplyByScalar(s1, coords.y, u1);
                u2 = Cartesian2.multiplyByScalar(s2, coords.z, u2);

                var texCoord = Cartesian2.add(u0, u1);
                Cartesian2.add(texCoord, u2, texCoord);

                texCoords.push(texCoord.x, texCoord.y);
            }
        }
    }

    function wrapLongitudeTriangles(geometry) {
        var attributes = geometry.attributes;
        var positions = attributes.position.values;
        var normals = (typeof attributes.normal !== 'undefined') ? attributes.normal.values : undefined;
        var binormals = (typeof attributes.binormal !== 'undefined') ? attributes.binormal.values : undefined;
        var tangents = (typeof attributes.tangent !== 'undefined') ? attributes.tangent.values : undefined;
        var texCoords = (typeof attributes.st !== 'undefined') ? attributes.st.values : undefined;
        var indices = geometry.indices;

        var newPositions = Array.prototype.slice.call(positions, 0);
        var newNormals = (typeof normals !== 'undefined') ? Array.prototype.slice.call(normals, 0) : undefined;
        var newBinormals = (typeof binormals !== 'undefined') ? Array.prototype.slice.call(binormals, 0) : undefined;
        var newTangents = (typeof tangents !== 'undefined') ? Array.prototype.slice.call(tangents, 0) : undefined;
        var newTexCoords = (typeof texCoords !== 'undefined') ? Array.prototype.slice.call(texCoords, 0) : undefined;
        var newIndices = [];

        var len = indices.length;
        for (var i = 0; i < len; i += 3) {
            var i0 = indices[i];
            var i1 = indices[i + 1];
            var i2 = indices[i + 2];

            var p0 = Cartesian3.fromArray(positions, i0 * 3);
            var p1 = Cartesian3.fromArray(positions, i1 * 3);
            var p2 = Cartesian3.fromArray(positions, i2 * 3);

            var result = splitTriangle(p0, p1, p2);
            if (typeof result !== 'undefined') {
                newPositions[i0 * 3 + 1] = result.positions[0].y;
                newPositions[i1 * 3 + 1] = result.positions[1].y;
                newPositions[i2 * 3 + 1] = result.positions[2].y;

                if (result.length > 3) {
                    var positionsLength = newPositions.length / 3;
                    for(var j = 0; j < result.indices.length; ++j) {
                        var index = result.indices[j];
                        if (index < 3) {
                            newIndices.push(indices[i + index]);
                        } else {
                            newIndices.push(index - 3 + positionsLength);
                        }
                    }

                    for (var k = 3; k < result.positions.length; ++k) {
                        var position = result.positions[k];
                        newPositions.push(position.x, position.y, position.z);
                    }
                    computeTriangleAttributes(i0, i1, i2, result, newNormals, newBinormals, newTangents, newTexCoords);
                } else {
                    newIndices.push(i0, i1, i2);
                }
            } else {
                newIndices.push(i0, i1, i2);
            }
        }

        geometry.attributes.position.values = new Float64Array(newPositions);

        if (typeof newNormals !== 'undefined') {
            attributes.normal.values = attributes.normal.componentDatatype.createTypedArray(newNormals);
        }

        if (typeof newBinormals !== 'undefined') {
            attributes.binormal.values = attributes.binormal.componentDatatype.createTypedArray(newBinormals);
        }

        if (typeof newTangents !== 'undefined') {
            attributes.tangent.values = attributes.tangent.componentDatatype.createTypedArray(newTangents);
        }

        if (typeof newTexCoords !== 'undefined') {
            attributes.st.values = attributes.st.componentDatatype.createTypedArray(newTexCoords);
        }

        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        geometry.indices = IndexDatatype.createTypedArray(numberOfVertices, newIndices);
    }

    function wrapLongitudeLines(geometry) {
        var attributes = geometry.attributes;
        var positions = attributes.position.values;
        var indices = geometry.indices;

        var newPositions = Array.prototype.slice.call(positions, 0);
        var newIndices = [];

        var xzPlane = Plane.fromPointNormal(Cartesian3.ZERO, Cartesian3.UNIT_Y);

        var length = indices.length;
        for ( var i = 0; i < length; i += 2) {
            var i0 = indices[i];
            var i1 = indices[i + 1];

            var prev = Cartesian3.fromArray(positions, i0 * 3);
            var cur = Cartesian3.fromArray(positions, i1 * 3);

            if (Math.abs(prev.y) < CesiumMath.EPSILON6){
                if (prev.y < 0.0) {
                    prev.y = -CesiumMath.EPSILON6;
                } else {
                    prev.y = CesiumMath.EPSILON6;
                }

                newPositions[i0 * 3 + 1] = prev.y;
            }

            if (Math.abs(cur.y) < CesiumMath.EPSILON6){
                if (cur.y < 0.0) {
                    cur.y = -CesiumMath.EPSILON6;
                } else {
                    cur.y = CesiumMath.EPSILON6;
                }

                newPositions[i1 * 3 + 1] = cur.y;
            }

            newIndices.push(i0);

            // intersects the IDL if either endpoint is on the negative side of the yz-plane
            if (prev.x < 0.0 || cur.x < 0.0) {
                // and intersects the xz-plane
                var intersection = IntersectionTests.lineSegmentPlane(prev, cur, xzPlane);
                if (typeof intersection !== 'undefined') {
                    // move point on the xz-plane slightly away from the plane
                    var offset = Cartesian3.multiplyByScalar(Cartesian3.UNIT_Y, 5.0 * CesiumMath.EPSILON9);
                    if (prev.y < 0.0) {
                        Cartesian3.negate(offset, offset);
                    }

                    var index = newPositions.length / 3;
                    newIndices.push(index, index + 1);

                    var offsetPoint = Cartesian3.add(intersection, offset);
                    newPositions.push(offsetPoint.x, offsetPoint.y, offsetPoint.z);

                    Cartesian3.negate(offset, offset);
                    Cartesian3.add(intersection, offset, offsetPoint);
                    newPositions.push(offsetPoint.x, offsetPoint.y, offsetPoint.z);
                }
            }

            newIndices.push(i1);
        }

        geometry.attributes.position.values = new Float64Array(newPositions);
        var numberOfVertices = Geometry.computeNumberOfVertices(geometry);
        geometry.indices = IndexDatatype.createTypedArray(numberOfVertices, newIndices);
    }

    /**
     * DOC_TBA
     */
    GeometryPipeline.wrapLongitude = function(geometry) {
        if (typeof geometry === 'undefined') {
            throw new DeveloperError('geometry is required.');
        }

        var boundingSphere = geometry.boundingSphere;
        if (typeof boundingSphere !== 'undefined') {
            var minX = boundingSphere.center.x - boundingSphere.radius;
            if (minX > 0 || BoundingSphere.intersect(boundingSphere, Cartesian4.UNIT_Y) !== Intersect.INTERSECTING) {
                return geometry;
            }
        }

        indexPrimitive(geometry);
        if (geometry.primitiveType === PrimitiveType.TRIANGLES) {
            wrapLongitudeTriangles(geometry);
        } else if (geometry.primitiveType === PrimitiveType.LINES) {
            wrapLongitudeLines(geometry);
        }

        return geometry;
    };

    return GeometryPipeline;
});
